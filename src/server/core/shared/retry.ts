import { isRetryable, RateLimitError, TimeoutError, toAppError } from './errors';

export interface RetryOptions {
  /** Número de tentativas extras após a primeira falha. */
  retries?: number;
  /** Atraso base em ms; dobra a cada tentativa. */
  baseDelayMs?: number;
  /** Teto do atraso, para não esperar minutos em backoff longo. */
  maxDelayMs?: number;
  /** Fator de jitter (0..1) para evitar thundering herd. */
  jitter?: number;
  /** Sobrescreve a decisão padrão de "é retentável?". */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (info: {
    error: unknown;
    attempt: number;
    delayMs: number;
  }) => void;
  /** Injetável para testes — evita esperar de verdade. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Executa `fn` com retry e backoff exponencial.
 *
 * Regras:
 * - só retenta erros marcados como `retryable` (rede, rate limit, timeout);
 * - respeita `retryAfterMs` do provider quando ele informa;
 * - aplica jitter para não sincronizar retries de várias fotos em paralelo.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    retries = 3,
    baseDelayMs = 500,
    maxDelayMs = 15_000,
    jitter = 0.25,
    shouldRetry = isRetryable,
    onRetry,
    sleep = defaultSleep,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === retries;
      if (isLastAttempt || !shouldRetry(error, attempt)) {
        throw toAppError(error);
      }

      const delayMs = computeDelay({
        error,
        attempt,
        baseDelayMs,
        maxDelayMs,
        jitter,
      });

      onRetry?.({ error, attempt: attempt + 1, delayMs });
      await sleep(delayMs);
    }
  }

  throw toAppError(lastError);
}

function computeDelay({
  error,
  attempt,
  baseDelayMs,
  maxDelayMs,
  jitter,
}: {
  error: unknown;
  attempt: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: number;
}): number {
  // Quando o provider diz quanto esperar, obedecemos.
  if (error instanceof RateLimitError && error.retryAfterMs !== undefined) {
    return Math.min(error.retryAfterMs, maxDelayMs);
  }

  const exponential = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  const jitterRange = exponential * jitter;
  const offset = (Math.random() * 2 - 1) * jitterRange;

  return Math.max(0, Math.round(exponential + offset));
}

/** Envolve uma promise com timeout, convertendo para TimeoutError. */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new TimeoutError(operation, timeoutMs)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
