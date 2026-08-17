/**
 * Hierarquia de erros do domínio.
 *
 * `retryable` orienta o `withRetry` e o pipeline: erros transitórios (rede,
 * rate limit, timeout) valem nova tentativa; erros de entrada (imagem
 * inválida, CSV malformado) não valem — repetir só queima orçamento.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_INPUT'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_ERROR'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'BUDGET_EXCEEDED'
  | 'NOT_FOUND'
  | 'UNKNOWN';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly context: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      retryable?: boolean;
      context?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code ?? 'UNKNOWN';
    this.retryable = options.retryable ?? false;
    this.context = options.context ?? {};
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      context: this.context,
    };
  }
}

/** Entrada do usuário não passou na validação. Nunca retentar. */
export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, { code: 'VALIDATION_ERROR', retryable: false, context });
  }
}

/** Arquivo/imagem inválido ou corrompido. Nunca retentar. */
export class InvalidInputError extends AppError {
  constructor(
    message: string,
    code: Extract<
      ErrorCode,
      'INVALID_INPUT' | 'FILE_TOO_LARGE' | 'UNSUPPORTED_FORMAT'
    > = 'INVALID_INPUT',
    context?: Record<string, unknown>,
  ) {
    super(message, { code, retryable: false, context });
  }
}

/**
 * O provider existe como contrato mas não há implementação utilizável
 * (falta credencial, parceria ou a integração ainda não foi construída).
 *
 * É o erro que os stubs de integração futura lançam — deixa explícito o que
 * falta, em vez de devolver dado inventado.
 */
export class ProviderUnavailableError extends AppError {
  constructor(provider: string, reason: string) {
    super(`Provider "${provider}" indisponível: ${reason}`, {
      code: 'PROVIDER_UNAVAILABLE',
      retryable: false,
      context: { provider, reason },
    });
  }
}

/** Falha na chamada a um serviço externo. Retentável por padrão. */
export class ProviderError extends AppError {
  constructor(
    message: string,
    options: {
      provider?: string;
      retryable?: boolean;
      status?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, {
      code: 'PROVIDER_ERROR',
      retryable: options.retryable ?? true,
      context: { provider: options.provider, status: options.status },
      cause: options.cause,
    });
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterMs: number | undefined;

  constructor(provider: string, retryAfterMs?: number) {
    super(`Rate limit atingido no provider "${provider}"`, {
      code: 'RATE_LIMIT',
      retryable: true,
      context: { provider, retryAfterMs },
    });
    this.retryAfterMs = retryAfterMs;
  }
}

export class TimeoutError extends AppError {
  constructor(operation: string, timeoutMs: number) {
    super(`Tempo esgotado em "${operation}" após ${timeoutMs}ms`, {
      code: 'TIMEOUT',
      retryable: true,
      context: { operation, timeoutMs },
    });
  }
}

/** Teto de custo da análise seria ultrapassado. Nunca retentar. */
export class BudgetExceededError extends AppError {
  constructor(spentUsd: number, limitUsd: number) {
    super(
      `Custo estimado (US$ ${spentUsd.toFixed(4)}) atingiu o limite ` +
        `de US$ ${limitUsd.toFixed(2)} para esta análise`,
      {
        code: 'BUDGET_EXCEEDED',
        retryable: false,
        context: { spentUsd, limitUsd },
      },
    );
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(`${resource} não encontrado${id ? `: ${id}` : ''}`, {
      code: 'NOT_FOUND',
      retryable: false,
      context: { resource, id },
    });
  }
}

/** Normaliza qualquer throw para AppError. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof Error) {
    return new AppError(error.message, { cause: error });
  }

  return new AppError(String(error));
}

export function isRetryable(error: unknown): boolean {
  return error instanceof AppError ? error.retryable : false;
}
