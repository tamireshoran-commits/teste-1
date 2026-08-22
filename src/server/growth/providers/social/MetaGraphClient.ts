import {
  InvalidInputError,
  ProviderError,
  RateLimitError,
  TimeoutError,
} from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';

const log = logger.child('meta-graph');

/**
 * Cliente HTTP da Graph API da Meta.
 *
 * Duas responsabilidades, e só elas: montar a URL versionada e **traduzir o
 * erro da Meta para o vocabulário de erros do sistema**. A segunda é a que
 * importa: a Graph API devolve 200 com corpo de erro em alguns casos e usa
 * códigos numéricos próprios, então sem esta tradução o `withRetry` não sabe
 * o que é transitório e fica retentando um token inválido até esgotar.
 *
 * A versão da API vem de `META_GRAPH_VERSION` e é fixada de propósito: a Meta
 * aposenta versões em cerca de dois anos, e descobrir isso em produção, no
 * meio de uma campanha, é o pior momento possível.
 */
export class MetaGraphClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    version: string;
    baseUrl?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  }) {
    const host = options.baseUrl ?? 'https://graph.facebook.com';
    this.baseUrl = `${host.replace(/\/$/, '')}/${options.version}`;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async get<T>(
    path: string,
    params: Record<string, string>,
    accessToken: string,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/${trimSlashes(path)}`);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    url.searchParams.set('access_token', accessToken);

    return this.request<T>(url, { method: 'GET' }, path);
  }

  async post<T>(
    path: string,
    body: Record<string, string>,
    accessToken: string,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/${trimSlashes(path)}`);
    const form = new URLSearchParams({ ...body, access_token: accessToken });

    return this.request<T>(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      },
      path,
    );
  }

  private async request<T>(
    url: URL,
    init: RequestInit,
    path: string,
  ): Promise<T> {
    let response: Response;

    try {
      response = await this.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      if (isAbortError(cause)) {
        throw new TimeoutError(`Graph API ${path}`, this.timeoutMs);
      }

      throw new ProviderError(`Falha de rede ao chamar a Graph API: ${path}`, {
        provider: 'meta',
        retryable: true,
        cause,
      });
    }

    const text = await response.text();
    const payload = safeParseJson(text);

    if (!response.ok || hasGraphError(payload)) {
      throw translateGraphError(payload, response.status, path);
    }

    return payload as T;
  }
}

interface GraphErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

/** Códigos de limite de uso da Meta. Todos valem nova tentativa mais tarde. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80001, 80002, 80003]);
/** Token inválido, expirado ou revogado. Retentar não resolve. */
const AUTH_CODES = new Set([102, 190, 463, 467]);
/** Permissão ausente — depende de App Review, não de nova tentativa. */
const PERMISSION_CODES = new Set([3, 10, 200, 299]);

function translateGraphError(
  payload: unknown,
  status: number,
  path: string,
): Error {
  const error = (payload as GraphErrorBody | null)?.error;
  const code = error?.code;
  const message = error?.message ?? `HTTP ${status}`;
  const context = { path, code, subcode: error?.error_subcode };

  log.warn('erro da Graph API', { ...context, message });

  if (code !== undefined && RATE_LIMIT_CODES.has(code)) {
    return new RateLimitError('meta');
  }

  if (code !== undefined && AUTH_CODES.has(code)) {
    return new ProviderError(
      `Token da Meta inválido ou expirado: ${message}. ` +
        'Reconecte a conta e gere um token de longa duração.',
      { provider: 'meta', retryable: false, status },
    );
  }

  if (code !== undefined && PERMISSION_CODES.has(code)) {
    return new ProviderError(
      `Permissão ausente na Graph API: ${message}. ` +
        'Verifique as permissões aprovadas no App Review.',
      { provider: 'meta', retryable: false, status },
    );
  }

  if (status === 429) return new RateLimitError('meta');

  if (status >= 500) {
    return new ProviderError(`Falha temporária da Meta: ${message}`, {
      provider: 'meta',
      retryable: true,
      status,
    });
  }

  if (status === 400 && code === 100) {
    return new InvalidInputError(
      `A Meta rejeitou os parâmetros da requisição: ${message}`,
      'INVALID_INPUT',
      context,
    );
  }

  return new ProviderError(`Erro da Graph API (${path}): ${message}`, {
    provider: 'meta',
    retryable: status >= 500,
    status,
  });
}

function hasGraphError(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'error' in payload &&
    (payload as GraphErrorBody).error !== undefined
  );
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: { message: text.slice(0, 300) } };
  }
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

function trimSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}
