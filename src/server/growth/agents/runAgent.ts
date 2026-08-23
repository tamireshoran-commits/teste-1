import type { z } from 'zod';
import { getPrompt, type PromptName } from '@/server/core/prompts/registry';
import type {
  LLMProvider,
  ModelTier,
} from '@/server/core/providers/ai/llm/LLMProvider';
import {
  buildCacheKey,
  sha256,
  type CacheStore,
} from '@/server/core/shared/cache';
import { estimateCost, type AIProviderName } from '@/server/core/shared/cost';
import { ProviderError, toAppError } from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';
import { withRetry } from '@/server/core/shared/retry';
import type { AIUsageRecorder } from '@/server/core/shared/usage';
import type { AgentKind } from '../types';

const log = logger.child('growth-agent');

/**
 * Execução instrumentada de um agente.
 *
 * Todo agente do sistema passa por aqui, e é isso que torna a operação
 * auditável: prompt versionado, saída validada por contrato, tokens
 * registrados e custo atribuído ao workspace. Um agente que chama o LLM
 * direto some do relatório de custo e volta a ser caixa-preta.
 *
 * O núcleo não conhece Prisma: quem quiser persistir a execução passa
 * `onRun`, e a camada de serviço grava em `growth_agent_runs`.
 */

export interface AgentRunRecord {
  agent: AgentKind;
  workspaceId: string;
  status: 'SUCCESS' | 'FAILED';
  promptName: string;
  promptVersion: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  fromCache: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface AgentResult<T> {
  data: T;
  run: AgentRunRecord;
}

export interface AgentDeps {
  workspaceId: string;
  llm: LLMProvider;
  usage?: AIUsageRecorder;
  /**
   * Cache por (operação, modelo, versão do prompt, entrada). Faz muita
   * diferença em desenvolvimento, onde o mesmo plano é gerado várias vezes;
   * em conversa de venda o cache é desligado de propósito — duas pessoas com
   * a mesma pergunta não podem receber a mesma resposta literal.
   */
  cache?: CacheStore;
  onRun?: (record: AgentRunRecord) => Promise<void>;
}

export interface RunAgentOptions<T> extends AgentDeps {
  agent: AgentKind;
  /** Nome da operação nos logs de custo. Ex.: "growth:market-strategy". */
  operation: string;
  prompt: PromptName;
  variables: Record<string, string | number | undefined>;
  schema: z.ZodType<T>;
  system?: string;
  tier?: ModelTier;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  retries?: number;
  cacheTtlMs?: number;
}

export async function runAgent<T>(
  options: RunAgentOptions<T>,
): Promise<AgentResult<T>> {
  const {
    agent,
    workspaceId,
    operation,
    prompt,
    variables,
    schema,
    llm,
    usage,
    cache,
    onRun,
    tier = 'cheap',
    temperature = 0.4,
    maxOutputTokens = 4000,
    timeoutMs,
    retries = 2,
    cacheTtlMs,
  } = options;

  const resolved = getPrompt(prompt, variables);
  const startedAt = Date.now();

  const cacheKey = cache
    ? buildCacheKey({
        operation,
        provider: llm.name,
        model: tier,
        promptVersion: resolved.version,
        inputHash: sha256(resolved.text),
      })
    : null;

  if (cache && cacheKey) {
    const hit = await cache.get<T>(cacheKey);

    if (hit !== null) {
      const record: AgentRunRecord = {
        agent,
        workspaceId,
        status: 'SUCCESS',
        promptName: resolved.name,
        promptVersion: resolved.version,
        provider: llm.name,
        model: `${tier} (cache)`,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: Date.now() - startedAt,
        fromCache: true,
      };

      await onRun?.(record);
      return { data: hit, run: record };
    }
  }

  try {
    const response = await withRetry(
      () =>
        llm.completeJSON<T>({
          prompt: resolved.text,
          parse: (raw) => parseWithSchema(schema, raw, resolved.name),
          tier,
          temperature,
          maxOutputTokens,
          ...(options.system !== undefined ? { system: options.system } : {}),
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        }),
      {
        retries,
        onRetry: ({ attempt, error }) =>
          log.warn('nova tentativa do agente', { agent, attempt, error }),
      },
    );

    const cost = estimateCost({
      provider: llm.name.toUpperCase() as AIProviderName,
      model: response.model,
      inputTokens: response.usage.inputTokens ?? 0,
      outputTokens: response.usage.outputTokens ?? 0,
    });

    const record: AgentRunRecord = {
      agent,
      workspaceId,
      status: 'SUCCESS',
      promptName: resolved.name,
      promptVersion: resolved.version,
      provider: llm.name,
      model: response.model,
      inputTokens: response.usage.inputTokens ?? 0,
      outputTokens: response.usage.outputTokens ?? 0,
      estimatedCostUsd: cost.estimatedCostUsd,
      latencyMs: Date.now() - startedAt,
      fromCache: false,
    };

    await usage?.record({
      workspaceId,
      provider: llm.name,
      model: response.model,
      operation,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      imageCount: 0,
      estimatedCostUsd: record.estimatedCostUsd,
      latencyMs: record.latencyMs,
      success: true,
    });

    if (cache && cacheKey) {
      await cache.set(cacheKey, response.data, cacheTtlMs);
    }

    await onRun?.(record);

    return { data: response.data, run: record };
  } catch (error) {
    const appError = toAppError(error);

    const record: AgentRunRecord = {
      agent,
      workspaceId,
      status: 'FAILED',
      promptName: resolved.name,
      promptVersion: resolved.version,
      provider: llm.name,
      model: tier,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: Date.now() - startedAt,
      fromCache: false,
      errorCode: appError.code,
      errorMessage: appError.message,
    };

    // A chamada que falhou consumiu tokens de entrada: registrar mantém o
    // relatório de custo honesto.
    await usage?.record({
      workspaceId,
      provider: llm.name,
      model: tier,
      operation,
      inputTokens: 0,
      outputTokens: 0,
      imageCount: 0,
      estimatedCostUsd: 0,
      latencyMs: record.latencyMs,
      success: false,
      errorCode: appError.code,
    });

    await onRun?.(record);

    throw appError;
  }
}

/**
 * Saída fora do contrato é tratada como erro **retentável**: o modelo às vezes
 * devolve um campo a menos, e uma segunda tentativa costuma resolver. O que
 * nunca acontece é o dado inválido seguir adiante.
 */
function parseWithSchema<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  promptName: string,
): T {
  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('; ');

    throw new ProviderError(
      `A saída do agente não respeita o contrato de "${promptName}": ${issues}`,
      { retryable: true },
    );
  }

  return parsed.data;
}
