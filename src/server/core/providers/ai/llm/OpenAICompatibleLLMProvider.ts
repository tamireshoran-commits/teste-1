import {
  InvalidInputError,
  ProviderError,
  RateLimitError,
  TimeoutError,
} from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';
import { extractJsonObject } from '../vision/photoResponseSchema';
import type { LLMProvider, LLMRequest, LLMResponse } from './LLMProvider';

const log = logger.child('openai-compatible');
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Provider para qualquer endpoint que fale o dialeto `/v1/chat/completions`.
 *
 * Uma classe cobre um ecossistema inteiro: OmniRoute e outros gateways, a
 * própria OpenAI, OpenRouter, Groq, Together, e modelos locais (Ollama,
 * LM Studio). Todos expõem o mesmo formato — o que muda é a URL base e o nome
 * do modelo, e os dois são configuração.
 *
 * É o que torna real a promessa da arquitetura: trocar de fornecedor de IA,
 * ou usar um roteador que escolhe o fornecedor mais barato a cada chamada, não
 * toca em nenhuma regra de negócio.
 */
export interface OpenAICompatibleOptions {
  /** Ex.: `http://localhost:20128/v1` (OmniRoute) ou `https://api.openai.com/v1`. */
  baseUrl: string;
  apiKey: string;
  cheapModel: string;
  smartModel: string;
  /**
   * Envia `response_format: json_object`. Nem todo modelo roteado aceita esse
   * campo; quando o endpoint recusa, a requisição é refeita sem ele — os
   * prompts já pedem JSON no texto, e `extractJsonObject` tolera cerca de
   * markdown em volta.
   */
  jsonMode?: boolean;
  defaultTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Nome exibido em logs e no registro de custo. */
  label?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
  error?: { message?: string; type?: string; code?: string | number };
}

export class OpenAICompatibleLLMProvider implements LLMProvider {
  readonly name: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly cheapModel: string;
  private readonly smartModel: string;
  private readonly jsonMode: boolean;
  private readonly defaultTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatibleOptions) {
    this.name = options.label ?? 'openai-compatible';
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.cheapModel = options.cheapModel;
    this.smartModel = options.smartModel;
    this.jsonMode = options.jsonMode ?? true;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async isAvailable(): Promise<boolean> {
    return this.baseUrl !== '' && this.apiKey !== '';
  }

  async completeJSON<T>(request: LLMRequest<T>): Promise<LLMResponse<T>> {
    const model = request.tier === 'smart' ? this.smartModel : this.cheapModel;
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;

    const messages: Array<{ role: string; content: string }> = [];

    if (request.system !== undefined) {
      messages.push({ role: 'system', content: request.system });
    }

    messages.push({ role: 'user', content: request.prompt });

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: request.temperature ?? 0.3,
      max_tokens: request.maxOutputTokens ?? 3000,
    };

    let payload: ChatCompletionResponse;

    try {
      payload = await this.post(
        { ...body, ...(this.jsonMode ? JSON_MODE_FIELD : {}) },
        timeoutMs,
        model,
      );
    } catch (error) {
      // Modelo roteado que não conhece `response_format` devolve 400. Refazer
      // sem o campo é melhor que falhar: o prompt já exige JSON.
      if (this.jsonMode && isJsonModeRejection(error)) {
        log.warn('endpoint recusou response_format; repetindo sem json mode', {
          model,
        });

        payload = await this.post(body, timeoutMs, model);
      } else {
        throw error;
      }
    }

    const text = payload.choices?.[0]?.message?.content;

    if (text === undefined || text === null || text.trim() === '') {
      throw new ProviderError('O modelo devolveu uma resposta vazia.', {
        provider: this.name,
        retryable: true,
      });
    }

    return {
      data: request.parse(extractJsonObject(text)),
      usage: {
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
      },
      // O roteador pode atender com um modelo diferente do pedido; registrar o
      // que ele respondeu é o que mantém o relatório de custo verdadeiro.
      model: payload.model ?? model,
      raw: text,
    };
  }

  private async post(
    body: Record<string, unknown>,
    timeoutMs: number,
    model: string,
  ): Promise<ChatCompletionResponse> {
    let response: Response;

    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      if (isAbortError(cause)) {
        throw new TimeoutError(`geração com ${model}`, timeoutMs);
      }

      throw new ProviderError(
        `Falha de rede ao chamar ${this.baseUrl}: ${describe(cause)}. ` +
          'Verifique se o gateway está no ar e acessível a partir da aplicação.',
        { provider: this.name, retryable: true, cause },
      );
    }

    const raw = await response.text();
    const payload = safeParse(raw);

    if (!response.ok || payload.error !== undefined) {
      throw this.translateError(response, payload, raw, model);
    }

    return payload;
  }

  private translateError(
    response: Response,
    payload: ChatCompletionResponse,
    raw: string,
    model: string,
  ): Error {
    const status = response.status;
    const message = payload.error?.message ?? raw.slice(0, 300);

    if (status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));

      return new RateLimitError(
        this.name,
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : undefined,
      );
    }

    if (status === 401 || status === 403) {
      return new ProviderError(
        `Credencial recusada por ${this.baseUrl}: ${message}. ` +
          'Confira a chave configurada em LLM_API_KEY.',
        { provider: this.name, retryable: false, status },
      );
    }

    if (status === 404) {
      return new ProviderError(
        `O modelo "${model}" não existe neste endpoint: ${message}. ` +
          'Ajuste LLM_MODEL_CHEAP/LLM_MODEL_SMART com um nome que o gateway ' +
          'conheça.',
        { provider: this.name, retryable: false, status },
      );
    }

    if (status === 400 || status === 422) {
      return new InvalidInputError(
        `O endpoint rejeitou a requisição: ${message}`,
        'INVALID_INPUT',
        { status, model },
      );
    }

    if (status >= 500 || status === 0) {
      return new ProviderError(`Falha temporária do endpoint: ${message}`, {
        provider: this.name,
        retryable: true,
        status,
      });
    }

    return new ProviderError(`Erro ao chamar o modelo: ${message}`, {
      provider: this.name,
      retryable: false,
      status,
    });
  }
}

const JSON_MODE_FIELD = { response_format: { type: 'json_object' } } as const;

function isJsonModeRejection(error: unknown): boolean {
  if (!(error instanceof InvalidInputError)) return false;

  return /response_format|json_object|json mode|unsupported/i.test(
    error.message,
  );
}

function safeParse(raw: string): ChatCompletionResponse {
  try {
    return JSON.parse(raw) as ChatCompletionResponse;
  } catch {
    return { error: { message: raw.slice(0, 300) } };
  }
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
