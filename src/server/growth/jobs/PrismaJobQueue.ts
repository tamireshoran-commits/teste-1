import { logger } from '@/server/core/shared/logger';
import { toAppError } from '@/server/core/shared/errors';
import type { Db } from '@/server/db/prisma';
import {
  retryDelayMs,
  type ClaimedJob,
  type EnqueueOptions,
  type EnqueueResult,
  type JobQueue,
} from './JobQueue';
import type { JobPayloadMap, JobType } from './types';

const log = logger.child('growth-queue');

/** Só os delegates usados aqui — mesma razão do `PrismaCacheStore`. */
export type JobDb = Pick<Db, 'growthJob' | '$queryRawUnsafe'>;

interface ClaimRow {
  id: string;
  type: string;
  payload: unknown;
  workspaceId: string | null;
  attempts: number;
  maxAttempts: number;
}

/**
 * Fila persistida em Postgres.
 *
 * `FOR UPDATE SKIP LOCKED` é o que permite rodar vários workers sem
 * coordenação externa: cada um trava as linhas que pegou e os outros
 * simplesmente pulam. É o mecanismo que torna Redis desnecessário nesta fase —
 * e a troca por BullMQ depois não toca em nenhum handler, porque todos
 * dependem da interface `JobQueue`, não desta classe.
 */
export class PrismaJobQueue implements JobQueue {
  constructor(private readonly db: JobDb) {}

  async enqueue<T extends JobType>(
    type: T,
    payload: JobPayloadMap[T],
    options: EnqueueOptions = {},
  ): Promise<EnqueueResult> {
    const { dedupeKey } = options;

    if (dedupeKey !== undefined) {
      const existing = await this.db.growthJob.findUnique({
        where: { dedupeKey },
        select: { id: true },
      });

      if (existing) {
        log.debug('job deduplicado', { type, dedupeKey });
        return { id: existing.id, deduped: true };
      }
    }

    try {
      const job = await this.db.growthJob.create({
        data: {
          type,
          payload: payload as object,
          workspaceId: options.workspaceId ?? null,
          runAt: options.runAt ?? new Date(),
          maxAttempts: options.maxAttempts ?? 3,
          dedupeKey: dedupeKey ?? null,
        },
        select: { id: true },
      });

      return { id: job.id, deduped: false };
    } catch (error) {
      // Corrida entre dois produtores com a mesma chave: quem perdeu apenas
      // reaproveita o job de quem ganhou.
      if (dedupeKey !== undefined && isUniqueViolation(error)) {
        const existing = await this.db.growthJob.findUnique({
          where: { dedupeKey },
          select: { id: true },
        });

        if (existing) return { id: existing.id, deduped: true };
      }

      throw toAppError(error);
    }
  }

  async claim(limit: number, workerId: string): Promise<ClaimedJob[]> {
    const rows = await this.db.$queryRawUnsafe<ClaimRow[]>(
      `UPDATE "growth_jobs" AS j
          SET status = 'RUNNING'::"JobStatus",
              "lockedAt" = now(),
              "lockedBy" = $1,
              attempts = j.attempts + 1,
              "updatedAt" = now()
        WHERE j.id IN (
          SELECT id
            FROM "growth_jobs"
           WHERE status = 'QUEUED'::"JobStatus"
             AND "runAt" <= now()
           ORDER BY "runAt" ASC
           LIMIT $2
             FOR UPDATE SKIP LOCKED
        )
    RETURNING j.id, j.type, j.payload, j."workspaceId", j.attempts, j."maxAttempts"`,
      workerId,
      limit,
    );

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      payload: row.payload,
      workspaceId: row.workspaceId,
      attempts: Number(row.attempts),
      maxAttempts: Number(row.maxAttempts),
    }));
  }

  async complete(jobId: string, result?: unknown): Promise<void> {
    await this.db.growthJob.update({
      where: { id: jobId },
      data: {
        status: 'DONE',
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        result: result === undefined ? undefined : (result as object),
      },
    });
  }

  async fail(jobId: string, error: unknown): Promise<void> {
    const appError = toAppError(error);

    const job = await this.db.growthJob.findUnique({
      where: { id: jobId },
      select: { attempts: true, maxAttempts: true, type: true },
    });

    if (!job) return;

    const exhausted = job.attempts >= job.maxAttempts;

    await this.db.growthJob.update({
      where: { id: jobId },
      data: {
        status: exhausted ? 'DEAD' : 'QUEUED',
        lockedAt: null,
        lockedBy: null,
        lastError: `${appError.code}: ${appError.message}`.slice(0, 1000),
        runAt: exhausted
          ? undefined
          : new Date(Date.now() + retryDelayMs(job.attempts)),
      },
    });

    if (exhausted) {
      log.error('job esgotou as tentativas', {
        jobId,
        type: job.type,
        error: appError,
      });
    }
  }

  async recoverStale(timeoutMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - timeoutMs);

    const { count } = await this.db.growthJob.updateMany({
      where: { status: 'RUNNING', lockedAt: { lt: cutoff } },
      data: { status: 'QUEUED', lockedAt: null, lockedBy: null },
    });

    if (count > 0) log.warn('jobs presos devolvidos à fila', { count });

    return count;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
