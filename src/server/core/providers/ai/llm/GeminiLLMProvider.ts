import { GoogleGenAI } from '@google/genai';
import {
  InvalidInputError,
  ProviderError,
  RateLimitError,
  TimeoutError,
} from '@/server/core/shared/errors';
import { extractJsonObject } from '../vision/photoResponseSchema';
import type { LLMProvider, LLMRequest, LLMResponse } from './LLMProvider';

const DEFAULT_TIMEOUT_MS = 60_000;

export interface GeminiLLMProviderOptions {
  apiKey: string;
  /** Modelo barato, para tarefas simples. */
  cheapModel: string;
  /** Modelo mais capaz, usado só quando a tarefa justifica o custo. */
  smartModel: string;
  defaultTimeoutMs?: number;
  client?: Pick<GoogleGenAI, 'models'>;
}

/**
 * Geração de JSON estruturado via Gemini.
 *
 * O `tier` da requisição escolhe o modelo: `cheap` para classificação e
 * extração, `smart` só quando a tarefa exige raciocínio. É o mecanismo que
 * atende ao requisito de custo — nada aqui decide sozinho usar o modelo caro.
 *
 * A tradução de erros segue a mesma ordem do provider de visão: status HTTP
 * antes de padrões de mensagem, para um 401 de credencial não ser confundido
 * com entrada inválida.
 */
export class GeminiLLMProvider implements LLMProvider {
  readonly name = 'gemini';

  private readonly client: Pick<GoogleGenAI, 'models'>;
  private readonly apiKey: string;
  private readonly cheapModel: string;
  private readonly smartModel: string;
  private readonly defaultTimeoutMs: number;

  constructor(options: GeminiLLMProviderOptions) {
    this.apiKey = options.apiKey;
    this.cheapModel = options.cheapModel;
    this.smartModel = options.smartModel;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.client = options.client ?? new GoogleGenAI({ apiKey: options.apiKey });
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.trim() !== '';
  }

  async completeJSON<T>(request: LLMRequest<T>): Promise<LLMResponse<T>> {
    const model = request.tier === 'smart' ? this.smartModel : this.cheapModel;
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const abortSignal = AbortSignal.timeout(timeoutMs);

    let response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;

    try {
      response = await this.client.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
        config: {
          abortSignal,
          responseMimeType: 'application/json',
          temperature: request.temperature ?? 0.3,
          maxOutputTokens: request.maxOutputTokens ?? 3000,
          ...(request.system !== undefined
            ? { systemInstruction: request.system }
            : {}),
        },
      });
    } catch (cause) {
      throw this.translateError(cause, model, timeoutMs);
    }

    const text = response.text;

    if (!text || text.trim() === '') {
      throw new ProviderError('O Gemini devolveu uma resposta vazia.', {
        provider: this.name,
        retryable: true,
      });
    }

    // O parse é do chamador (com Zod): o provider só garante JSON parseável.
    const data = request.parse(extractJsonObject(text));

    return {
      data,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
      model,
      raw: text,
    };
  }

  private translateError(
    cause: unknown,
    model: string,
    timeoutMs: number,
  ): Error {
    if (isAbortError(cause)) {
      return new TimeoutError(`geração com ${model}`, timeoutMs);
    }

    const status = extractStatus(cause);
    const message = extractMessage(cause);

    if (status !== undefined) {
      if (status === 429) return new RateLimitError(this.name);

      if (status === 401 || status === 403) {
        return new ProviderError(
          `Credencial do Gemini inválida ou sem permissão: ${message}`,
          { provider: this.name, retryable: false, status },
        );
      }

      if (status === 404) {
        return new ProviderError(
          `O modelo "${model}" não está disponível para esta chave. ` +
            `Ajuste LLM_MODEL_CHEAP/LLM_MODEL_SMART. Resposta: ${message}`,
          { provider: this.name, retryable: false, status },
        );
      }

      if (status === 400 || status === 422) {
        return new InvalidInputError(
          `O Gemini rejeitou a requisição: ${message}`,
          'INVALID_INPUT',
          { status },
        );
      }

      if (status >= 500) {
        return new ProviderError(`Falha temporária do Gemini: ${message}`, {
          provider: this.name,
          retryable: true,
          status,
          cause,
        });
      }
    }

    if (/rate.?limit|quota|resource.?exhausted/i.test(message)) {
      return new RateLimitError(this.name);
    }

    if (/unauthenticated|permission.?denied|api.?key/i.test(message)) {
      return new ProviderError(
        `Credencial do Gemini inválida ou sem permissão: ${message}`,
        { provider: this.name, retryable: false },
      );
    }

    return new ProviderError(`Erro ao chamar o Gemini: ${message}`, {
      provider: this.name,
      retryable: true,
      cause,
    });
  }
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

function extractStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  const record = error as Record<string, unknown>;

  for (const key of ['status', 'statusCode', 'code']) {
    const value = record[key];
    if (typeof value === 'number' && value >= 100 && value < 600) return value;
  }

  const match = /\b(4\d{2}|5\d{2})\b/.exec(extractMessage(error));
  return match ? Number(match[1]) : undefined;
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}
