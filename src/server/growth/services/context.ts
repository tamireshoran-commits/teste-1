import { getGrowthLLMProvider } from '../providers/registry';
import { InMemoryCacheStore } from '@/server/core/shared/cache';
import { NotFoundError } from '@/server/core/shared/errors';
import { prisma } from '@/server/db/prisma';
import { PrismaCacheStore } from '@/server/db/PrismaCacheStore';
import { PrismaUsageRecorder } from '@/server/db/PrismaUsageRecorder';
import type { AgentDeps, AgentRunRecord } from '../agents/runAgent';
import type {
  BrandContext,
  ProductSummary,
  WorkspaceSettings,
} from '../types';

/**
 * Carregamento do contexto do workspace.
 *
 * Todo agente precisa das mesmas quatro coisas: configuração, marca, catálogo
 * e estratégia ativa. Centralizar aqui garante que o vendedor e o estrategista
 * enxerguem exatamente o mesmo catálogo — se cada um montasse o seu, uma
 * mudança de preço apareceria em um e não no outro.
 */

export interface WorkspaceContext {
  settings: WorkspaceSettings;
  brand: BrandContext;
  products: ProductSummary[];
  strategy: {
    id: string;
    valueProposition: string;
    persona: unknown;
    pains: string[];
    desires: string[];
    objections: Array<{ objection: string; response: string }>;
  } | null;
}

export async function loadWorkspaceContext(
  workspaceId: string,
): Promise<WorkspaceContext> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      brandProfile: true,
      products: { where: { isActive: true }, orderBy: { createdAt: 'asc' } },
      strategies: {
        where: { status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
        take: 1,
      },
    },
  });

  if (!workspace) throw new NotFoundError('Workspace', workspaceId);

  const strategy = workspace.strategies[0];

  return {
    settings: {
      id: workspace.id,
      mode: workspace.mode,
      timezone: workspace.timezone,
      quietHoursStart: workspace.quietHoursStart,
      quietHoursEnd: workspace.quietHoursEnd,
      maxDailyCostUsd: workspace.maxDailyCostUsd,
      maxMessagesPerContactPerDay: workspace.maxMessagesPerContactPerDay,
      maxPublicationsPerDay: workspace.maxPublicationsPerDay,
    },
    brand: {
      name: workspace.brandProfile?.name ?? workspace.name,
      description: workspace.brandProfile?.description ?? null,
      toneOfVoice:
        workspace.brandProfile?.toneOfVoice ??
        'Profissional, direto e acolhedor.',
      valueProposition: workspace.brandProfile?.valueProposition ?? null,
      doNotSay: asStringArray(workspace.brandProfile?.doNotSay),
      guardrails: asStringArray(workspace.brandProfile?.guardrails),
      defaultCta: workspace.brandProfile?.defaultCta ?? null,
      language: workspace.brandProfile?.language ?? 'pt-BR',
    },
    products: workspace.products.map(toProductSummary),
    strategy: strategy
      ? {
          id: strategy.id,
          valueProposition: strategy.valueProposition,
          persona: strategy.persona,
          pains: asStringArray(strategy.pains),
          desires: asStringArray(strategy.desires),
          objections: asObjections(strategy.objections),
        }
      : null,
  };
}

export function toProductSummary(product: {
  id: string;
  name: string;
  description: string;
  priceCents: number | null;
  currency: string;
  checkoutUrl: string | null;
  schedulingUrl: string | null;
  benefits: unknown;
}): ProductSummary {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    priceCents: product.priceCents,
    currency: product.currency,
    checkoutUrl: product.checkoutUrl,
    schedulingUrl: product.schedulingUrl,
    benefits: asStringArray(product.benefits),
  };
}

/**
 * Dependências de agente ligadas ao banco.
 *
 * `onRun` persiste cada execução em `growth_agent_runs`: é o que permite
 * responder "quanto custou operar este workspace neste mês, por agente" sem
 * instrumentar cada chamada na mão.
 */
export function agentDeps(
  workspaceId: string,
  options: { cache?: boolean; jobId?: string } = {},
): AgentDeps {
  const llm = getGrowthLLMProvider();

  return {
    workspaceId,
    llm,
    usage: new PrismaUsageRecorder(prisma),
    cache:
      options.cache === true
        ? new PrismaCacheStore(prisma, {
            provider: llm.name,
            model: 'growth',
            operation: 'growth-agent',
          })
        : undefined,
    onRun: async (record: AgentRunRecord) => {
      await prisma.agentRun.create({
        data: {
          workspaceId: record.workspaceId,
          agent: record.agent,
          status: record.status,
          promptName: record.promptName,
          promptVersion: record.promptVersion,
          provider: record.provider,
          model: record.model,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          estimatedCostUsd: record.estimatedCostUsd,
          latencyMs: record.latencyMs,
          errorCode: record.errorCode ?? null,
          errorMessage: record.errorMessage ?? null,
          jobId: options.jobId ?? null,
          finishedAt: new Date(),
        },
      });
    },
  };
}

/** Cache em memória para testes que não tocam o banco. */
export const testCacheStore = new InMemoryCacheStore();

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function asObjections(
  value: unknown,
): Array<{ objection: string; response: string }> {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];

    const record = item as Record<string, unknown>;
    const objection = record['objection'];
    const response = record['response'];

    return typeof objection === 'string'
      ? [
          {
            objection,
            response: typeof response === 'string' ? response : '',
          },
        ]
      : [];
  });
}
