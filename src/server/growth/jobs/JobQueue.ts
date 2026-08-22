import type { JobPayloadMap, JobType } from './types';

export interface EnqueueOptions {
  workspaceId?: string | null;
  /** Quando executar. Ausente = agora. */
  runAt?: Date;
  /**
   * Chave de deduplicação. O webhook da Meta reenvia o mesmo evento quando não
   * recebe 200 a tempo; sem esta chave, a mesma pessoa recebe duas respostas.
   */
  dedupeKey?: string;
  maxAttempts?: number;
}

export interface EnqueueResult {
  id: string;
  /** true quando já existia um job com a mesma `dedupeKey`. */
  deduped: boolean;
}

export interface ClaimedJob {
  id: string;
  type: string;
  payload: unknown;
  workspaceId: string | null;
  attempts: number;
  maxAttempts: number;
}

export interface JobQueue {
  enqueue<T extends JobType>(
    type: T,
    payload: JobPayloadMap[T],
    options?: EnqueueOptions,
  ): Promise<EnqueueResult>;

  /** Reserva jobs prontos para execução, marcando-os como RUNNING. */
  claim(limit: number, workerId: string): Promise<ClaimedJob[]>;

  complete(jobId: string, result?: unknown): Promise<void>;

  /**
   * Marca falha. Reagenda com backoff enquanto houver tentativa; ao esgotar,
   * o job vira DEAD e aparece no painel — falha silenciosa em fila é o jeito
   * mais rápido de perder um lead sem ninguém perceber.
   */
  fail(jobId: string, error: unknown): Promise<void>;

  /** Devolve à fila jobs presos em RUNNING (worker morto no meio). */
  recoverStale(timeoutMs: number): Promise<number>;
}

/** Backoff: 1min, 2min, 4min... com teto de 1h. */
export function retryDelayMs(attempts: number): number {
  const base = 60_000 * 2 ** Math.max(0, attempts - 1);
  return Math.min(base, 60 * 60_000);
}
