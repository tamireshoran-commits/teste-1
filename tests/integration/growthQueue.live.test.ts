import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaJobQueue } from '@/server/growth/jobs/PrismaJobQueue';
import { ConversationService } from '@/server/growth/services/ConversationService';

/**
 * Fila e ingestão contra o Postgres real.
 *
 * São as duas partes do sistema em que "funciona em memória" não prova nada:
 * o `FOR UPDATE SKIP LOCKED` da fila e o índice único que torna o webhook
 * idempotente só existem no banco. Um mock passaria com a implementação
 * errada.
 *
 * Pulado quando `DATABASE_URL` não está no ambiente.
 */

const connectionString = process.env['DATABASE_URL'];
const describeDb = connectionString ? describe : describe.skip;

describeDb('Fila e CRM do Growth Engine (Postgres real)', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: connectionString! }),
  });

  const queue = new PrismaJobQueue(prisma);
  const conversations = new ConversationService();
  const suffix = `growth-test-${Date.now()}`;

  let userId = '';
  let workspaceId = '';

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `${suffix}@example.invalid`, name: 'Teste' },
    });

    userId = user.id;

    const workspace = await prisma.workspace.create({
      data: { ownerId: userId, name: 'Workspace de teste', slug: suffix },
    });

    workspaceId = workspace.id;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('deduplica jobs pela chave', async () => {
    const key = `dedupe:${suffix}`;

    const first = await queue.enqueue(
      'followup.scan',
      { workspaceId },
      { workspaceId, dedupeKey: key },
    );

    const second = await queue.enqueue(
      'followup.scan',
      { workspaceId },
      { workspaceId, dedupeKey: key },
    );

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it('reserva o job uma vez só e conclui', async () => {
    const { id } = await queue.enqueue(
      'followup.scan',
      { workspaceId },
      { workspaceId, dedupeKey: `claim:${suffix}` },
    );

    const claimed = await queue.claim(10, 'worker-a');
    const mine = claimed.find((job) => job.id === id);

    expect(mine).toBeDefined();
    expect(mine?.attempts).toBe(1);

    // Segundo worker não pode pegar o mesmo job.
    const again = await queue.claim(10, 'worker-b');
    expect(again.find((job) => job.id === id)).toBeUndefined();

    await queue.complete(id, { ok: true });

    const stored = await prisma.growthJob.findUniqueOrThrow({ where: { id } });
    expect(stored.status).toBe('DONE');
  });

  it('reagenda com backoff e marca DEAD ao esgotar as tentativas', async () => {
    const { id } = await queue.enqueue(
      'followup.scan',
      { workspaceId },
      { workspaceId, dedupeKey: `fail:${suffix}`, maxAttempts: 2 },
    );

    await queue.claim(10, 'worker-a');
    await queue.fail(id, new Error('erro simulado'));

    const afterFirst = await prisma.growthJob.findUniqueOrThrow({ where: { id } });
    expect(afterFirst.status).toBe('QUEUED');
    expect(afterFirst.runAt.getTime()).toBeGreaterThan(Date.now());
    expect(afterFirst.lastError).toContain('erro simulado');

    // Segunda tentativa esgota o limite.
    await prisma.growthJob.update({
      where: { id },
      data: { runAt: new Date(Date.now() - 1000) },
    });

    await queue.claim(10, 'worker-a');
    await queue.fail(id, new Error('erro simulado 2'));

    const afterSecond = await prisma.growthJob.findUniqueOrThrow({ where: { id } });
    expect(afterSecond.status).toBe('DEAD');
  });

  it('devolve à fila jobs presos em RUNNING', async () => {
    const { id } = await queue.enqueue(
      'followup.scan',
      { workspaceId },
      { workspaceId, dedupeKey: `stale:${suffix}` },
    );

    await queue.claim(10, 'worker-morto');

    await prisma.growthJob.update({
      where: { id },
      data: { lockedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });

    const recovered = await queue.recoverStale(60_000);
    expect(recovered).toBeGreaterThanOrEqual(1);

    const stored = await prisma.growthJob.findUniqueOrThrow({ where: { id } });
    expect(stored.status).toBe('QUEUED');
    expect(stored.lockedBy).toBeNull();
  });

  it('ingestão de webhook é idempotente', async () => {
    const input = {
      workspaceId,
      platform: 'INSTAGRAM' as const,
      channel: 'IG_DM' as const,
      contactExternalId: `pessoa-${suffix}`,
      contactUsername: 'fulana',
      text: 'quanto custa?',
      externalMessageId: `mid-${suffix}`,
      occurredAt: new Date(),
      socialAccountId: null,
      sourceExternalPostId: null,
    };

    const first = await conversations.ingestInbound(input);
    const second = await conversations.ingestInbound(input);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.conversationId).toBe(first.conversationId);

    const messages = await prisma.message.count({
      where: { conversationId: first.conversationId },
    });

    expect(messages).toBe(1);

    const history = await conversations.history(first.conversationId);
    expect(history).toHaveLength(1);
    expect(history[0]?.direction).toBe('INBOUND');
  });
});
