import { logger } from '@/server/core/shared/logger';
import { toAppError } from '@/server/core/shared/errors';
import type { ClaimedJob, JobQueue } from './JobQueue';
import { isJobType, type JobType } from './types';

const log = logger.child('growth-worker');

export interface JobContext {
  jobId: string;
  workspaceId: string | null;
  attempt: number;
}

export type JobHandler = (
  payload: unknown,
  context: JobContext,
) => Promise<unknown>;

export type JobHandlerMap = Partial<Record<JobType, JobHandler>>;

export type WorkerResult = {
  claimed: number;
  completed: number;
  failed: number;
  recovered: number;
};

/**
 * Um "tick" do worker: recupera jobs presos, reserva um lote e executa.
 *
 * É uma função e não um laço infinito de propósito — assim serve tanto para um
 * processo dedicado (chamando em loop) quanto para um cron HTTP em ambiente
 * serverless, onde não existe processo longo. Trocar de hospedagem não muda o
 * código do worker.
 */
export async function runWorkerTick(deps: {
  queue: JobQueue;
  handlers: JobHandlerMap;
  batchSize: number;
  workerId: string;
  lockTimeoutMs: number;
}): Promise<WorkerResult> {
  const recovered = await deps.queue.recoverStale(deps.lockTimeoutMs);
  const jobs = await deps.queue.claim(deps.batchSize, deps.workerId);

  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    const ok = await executeJob(job, deps);
    if (ok) completed++;
    else failed++;
  }

  return { claimed: jobs.length, completed, failed, recovered };
}

async function executeJob(
  job: ClaimedJob,
  deps: { queue: JobQueue; handlers: JobHandlerMap },
): Promise<boolean> {
  const jobLog = log.child('job', { jobId: job.id, type: job.type });

  if (!isJobType(job.type)) {
    await deps.queue.fail(job.id, new Error(`Tipo de job desconhecido: ${job.type}`));
    return false;
  }

  const handler = deps.handlers[job.type];

  if (!handler) {
    await deps.queue.fail(
      job.id,
      new Error(`Nenhum handler registrado para "${job.type}"`),
    );
    return false;
  }

  const startedAt = Date.now();

  try {
    const result = await handler(job.payload, {
      jobId: job.id,
      workspaceId: job.workspaceId,
      attempt: job.attempts,
    });

    await deps.queue.complete(job.id, result);
    jobLog.info('job concluído', { durationMs: Date.now() - startedAt });

    return true;
  } catch (error) {
    const appError = toAppError(error);

    jobLog.error('job falhou', {
      error: appError,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
    });

    await deps.queue.fail(job.id, appError);

    return false;
  }
}
