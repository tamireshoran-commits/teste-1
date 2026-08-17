import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImageAnalysisService } from '@/server/core/analysis/photos/ImageAnalysisService';
import { MockVisionProvider } from '@/server/core/providers/ai/vision/MockVisionProvider';
import { sha256 } from '@/server/core/shared/cache';
import type { ImageInput } from '@/server/core/types';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaCacheStore } from '@/server/db/PrismaCacheStore';
import { PrismaUsageRecorder } from '@/server/db/PrismaUsageRecorder';

/**
 * Integração com o Postgres real.
 *
 * Prova que `AICache` e `AIUsageLog` funcionam de ponta a ponta — em memória
 * qualquer implementação passa; o que interessa é o comportamento contra o
 * banco, incluindo o incremento de custo na análise.
 *
 * Pulado quando `DATABASE_URL` não está no ambiente.
 */

const connectionString = process.env['DATABASE_URL'];
const describeDb = connectionString ? describe : describe.skip;

describeDb('Persistência de cache e custo (Postgres real)', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: connectionString! }),
  });

  const suffix = `test-${Date.now()}`;
  let userId = '';
  let propertyId = '';
  let analysisId = '';

  function makeImage(id: string, content: string): ImageInput {
    const data = new TextEncoder().encode(content);
    return {
      id,
      data,
      mimeType: 'image/jpeg',
      sizeBytes: data.byteLength,
      position: 0,
      sha256: sha256(data),
    };
  }

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `${suffix}@stayscore.test`, name: 'Teste' },
    });
    userId = user.id;

    const property = await prisma.property.create({
      data: { userId, name: `Imóvel ${suffix}` },
    });
    propertyId = property.id;

    const analysis = await prisma.analysis.create({
      data: { userId, propertyId },
    });
    analysisId = analysis.id;
  });

  afterAll(async () => {
    // Cascade limpa property, analysis, logs e cache vinculados.
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.aICache.deleteMany({ where: { operation: `test-${suffix}` } });
    await prisma.$disconnect();
  });

  it('grava e lê do AICache', async () => {
    const store = new PrismaCacheStore(prisma, {
      provider: 'mock',
      model: 'mock-model',
      operation: `test-${suffix}`,
    });

    const key = `chave-${suffix}`;
    expect(await store.get(key)).toBeNull();

    await store.set(key, { score: 87, roomType: 'sala' });

    expect(await store.get<{ score: number }>(key)).toEqual({
      score: 87,
      roomType: 'sala',
    });

    const row = await prisma.aICache.findUnique({ where: { cacheKey: key } });
    expect(row?.provider).toBe('mock');
  });

  it('respeita a expiração do cache', async () => {
    const store = new PrismaCacheStore(prisma, {
      provider: 'mock',
      model: 'mock-model',
      operation: `test-${suffix}`,
    });

    const key = `expirado-${suffix}`;
    await store.set(key, { a: 1 }, -1000);

    expect(await store.get(key)).toBeNull();
  });

  it('registra uso no AIUsageLog e acumula o custo na análise', async () => {
    const recorder = new PrismaUsageRecorder(prisma);

    await recorder.record({
      analysisId,
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      operation: 'photo-analysis',
      inputTokens: 1500,
      outputTokens: 300,
      imageCount: 1,
      estimatedCostUsd: 0.0025,
      latencyMs: 1200,
      success: true,
    });

    const logs = await prisma.aIUsageLog.findMany({ where: { analysisId } });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      provider: 'gemini',
      inputTokens: 1500,
      outputTokens: 300,
      success: true,
    });

    const analysis = await prisma.analysis.findUnique({ where: { id: analysisId } });
    expect(analysis?.estimatedCostUsd).toBeCloseTo(0.0025, 6);
  });

  it('registra falhas sem acumular custo', async () => {
    const recorder = new PrismaUsageRecorder(prisma);
    const before = await prisma.analysis.findUnique({ where: { id: analysisId } });

    await recorder.record({
      analysisId,
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      operation: 'photo-analysis',
      inputTokens: 0,
      outputTokens: 0,
      imageCount: 1,
      estimatedCostUsd: 0,
      success: false,
      errorCode: 'RATE_LIMIT',
    });

    const failures = await prisma.aIUsageLog.findMany({
      where: { analysisId, success: false },
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]!.errorCode).toBe('RATE_LIMIT');

    const after = await prisma.analysis.findUnique({ where: { id: analysisId } });
    expect(after?.estimatedCostUsd).toBeCloseTo(before!.estimatedCostUsd, 6);
  });

  it('pipeline completo: segunda análise da mesma foto vem do banco', async () => {
    const cache = new PrismaCacheStore(prisma, {
      provider: 'mock',
      model: 'mock-model',
      operation: 'photo-analysis',
    });
    const recorder = new PrismaUsageRecorder(prisma);
    const service = new ImageAnalysisService(new MockVisionProvider(), {
      cache,
      usageRecorder: recorder,
    });

    // Conta o delta, não o total: testes anteriores desta suíte já gravaram
    // logs na mesma análise.
    const countLogs = () =>
      prisma.aIUsageLog.count({
        where: { analysisId, operation: 'photo-analysis', success: true },
      });

    const before = await countLogs();

    const conteudo = `foto-unica-${suffix}`;
    const first = await service.analyzeBatch([makeImage('p1', conteudo)], {
      analysisId,
    });

    expect(first.results).toHaveLength(1);
    expect(first.cacheHits).toBe(0);
    expect(await countLogs()).toBe(before + 1);

    const second = await service.analyzeBatch([makeImage('p2', conteudo)], {
      analysisId,
    });

    expect(second.cacheHits).toBe(1);
    expect(second.results[0]!.fromCache).toBe(true);
    expect(second.results[0]!.photoId).toBe('p2');

    // O acerto de cache não pode gerar nova linha de uso.
    expect(await countLogs()).toBe(before + 1);
  });
});
