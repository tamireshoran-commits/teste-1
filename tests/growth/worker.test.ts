import { describe, expect, it } from 'vitest';
import { retryDelayMs, type ClaimedJob, type JobQueue } from '@/server/growth/jobs/JobQueue';
import { runWorkerTick } from '@/server/growth/jobs/worker';

/** Fila em memória, só com o comportamento que o worker enxerga. */
class FakeQueue implements JobQueue {
  completed: string[] = [];
  failed: Array<{ id: string; error: unknown }> = [];
  recovered = 0;

  constructor(private readonly jobs: ClaimedJob[]) {}

  async enqueue(): Promise<{ id: string; deduped: boolean }> {
    return { id: 'x', deduped: false };
  }

  async claim(limit: number): Promise<ClaimedJob[]> {
    return this.jobs.splice(0, limit);
  }

  async complete(jobId: string): Promise<void> {
    this.completed.push(jobId);
  }

  async fail(jobId: string, error: unknown): Promise<void> {
    this.failed.push({ id: jobId, error });
  }

  async recoverStale(): Promise<number> {
    return this.recovered;
  }
}

function job(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    id: 'job-1',
    type: 'followup.scan',
    payload: { workspaceId: 'ws-1' },
    workspaceId: 'ws-1',
    attempts: 1,
    maxAttempts: 3,
    ...overrides,
  };
}

describe('worker', () => {
  it('executa o handler e conclui o job', async () => {
    const queue = new FakeQueue([job()]);
    let received: unknown;

    const result = await runWorkerTick({
      queue,
      handlers: {
        'followup.scan': async (payload) => {
          received = payload;
          return { ok: true };
        },
      },
      batchSize: 5,
      workerId: 'test',
      lockTimeoutMs: 1000,
    });

    expect(result).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(queue.completed).toEqual(['job-1']);
    expect(received).toEqual({ workspaceId: 'ws-1' });
  });

  it('marca falha quando o handler estoura, sem derrubar o lote', async () => {
    const queue = new FakeQueue([job({ id: 'a' }), job({ id: 'b' })]);
    let executed = 0;

    const result = await runWorkerTick({
      queue,
      handlers: {
        'followup.scan': async () => {
          executed++;
          if (executed === 1) throw new Error('erro simulado');
          return { ok: true };
        },
      },
      batchSize: 5,
      workerId: 'test',
      lockTimeoutMs: 1000,
    });

    expect(result).toMatchObject({ claimed: 2, completed: 1, failed: 1 });
    expect(queue.failed[0]?.id).toBe('a');
    expect(queue.completed).toEqual(['b']);
  });

  it('falha jobs de tipo desconhecido em vez de ignorá-los', async () => {
    const queue = new FakeQueue([job({ type: 'tipo.inexistente' })]);

    const result = await runWorkerTick({
      queue,
      handlers: {},
      batchSize: 5,
      workerId: 'test',
      lockTimeoutMs: 1000,
    });

    expect(result.failed).toBe(1);
    expect(String(queue.failed[0]?.error)).toMatch(/desconhecido/);
  });

  it('falha quando não há handler registrado para o tipo', async () => {
    const queue = new FakeQueue([job()]);

    const result = await runWorkerTick({
      queue,
      handlers: {},
      batchSize: 5,
      workerId: 'test',
      lockTimeoutMs: 1000,
    });

    expect(result.failed).toBe(1);
    expect(String(queue.failed[0]?.error)).toMatch(/Nenhum handler/);
  });

  it('o backoff cresce e tem teto de uma hora', () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(120_000);
    expect(retryDelayMs(3)).toBe(240_000);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });
});
