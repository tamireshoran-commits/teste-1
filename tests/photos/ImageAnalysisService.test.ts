import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageAnalysisService } from '@/server/core/analysis/photos/ImageAnalysisService';
import type {
  VisionAnalyzeOptions,
  VisionAnalyzeOutput,
  VisionProvider,
} from '@/server/core/providers/ai/vision/VisionProvider';
import { MockVisionProvider } from '@/server/core/providers/ai/vision/MockVisionProvider';
import { InMemoryCacheStore, sha256 } from '@/server/core/shared/cache';
import {
  InvalidInputError,
  ProviderError,
  RateLimitError,
} from '@/server/core/shared/errors';
import { NoopUsageRecorder } from '@/server/core/shared/usage';
import type { ImageInput } from '@/server/core/types';

function makeImage(id: string, position = 0, content = id): ImageInput {
  const data = new TextEncoder().encode(content);

  return {
    id,
    data,
    mimeType: 'image/jpeg',
    sizeBytes: data.byteLength,
    position,
    sha256: sha256(data),
  };
}

/** Provider controlável, para dirigir sucesso e falha por foto. */
class StubVisionProvider implements VisionProvider {
  readonly name = 'stub';
  readonly model = 'mock-model';
  calls = 0;

  constructor(
    private readonly behavior: (
      image: ImageInput,
      call: number,
    ) => VisionAnalyzeOutput | Error,
  ) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async analyzeImage(
    image: ImageInput,
    _options?: VisionAnalyzeOptions,
  ): Promise<VisionAnalyzeOutput> {
    this.calls++;
    const outcome = this.behavior(image, this.calls);

    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}

function okOutput(image: ImageInput, score = 80): VisionAnalyzeOutput {
  return {
    result: {
      photoId: image.id,
      roomType: 'sala',
      visualQuality: score,
      lighting: score,
      composition: score,
      professionalism: score,
      valuePerception: score,
      clarity: score,
      strengths: [],
      problems: [],
      recommendations: [],
      score,
    },
    usage: { inputTokens: 1000, outputTokens: 200, imageCount: 1 },
  };
}

describe('ImageAnalysisService — isolamento de falhas', () => {
  it('uma foto que falha não derruba o lote', async () => {
    const provider = new StubVisionProvider((image) =>
      image.id === 'ruim'
        ? new InvalidInputError('imagem corrompida')
        : okOutput(image),
    );

    const service = new ImageAnalysisService(provider, {}, { retries: 0 });

    const result = await service.analyzeBatch([
      makeImage('a'),
      makeImage('ruim'),
      makeImage('b'),
    ]);

    expect(result.results).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      photoId: 'ruim',
      errorCode: 'INVALID_INPUT',
      retryable: false,
    });
    expect(result.totalRequested).toBe(3);
  });

  it('o lote inteiro pode falhar sem lançar exceção', async () => {
    const provider = new StubVisionProvider(() => new ProviderError('fora do ar'));
    const service = new ImageAnalysisService(provider, {}, { retries: 0 });

    const result = await service.analyzeBatch([makeImage('a'), makeImage('b')]);

    expect(result.results).toHaveLength(0);
    expect(result.failures).toHaveLength(2);
  });

  it('preserva a informação de retentabilidade em cada falha', async () => {
    const provider = new StubVisionProvider((image) =>
      image.id === 'transitorio'
        ? new RateLimitError('stub')
        : new InvalidInputError('formato inválido'),
    );

    const service = new ImageAnalysisService(provider, {}, { retries: 0 });

    const result = await service.analyzeBatch([
      makeImage('transitorio'),
      makeImage('definitivo'),
    ]);

    const byId = Object.fromEntries(
      result.failures.map((f) => [f.photoId, f]),
    );

    expect(byId['transitorio']!.retryable).toBe(true);
    expect(byId['definitivo']!.retryable).toBe(false);
  });
});

describe('ImageAnalysisService — retry', () => {
  it('retenta erro transitório e conclui com sucesso', async () => {
    let attempts = 0;

    const provider = new StubVisionProvider((image) => {
      attempts++;
      return attempts < 3 ? new ProviderError('instável') : okOutput(image);
    });

    const service = new ImageAnalysisService(provider, {}, { retries: 3 });
    const result = await service.analyzeBatch([makeImage('a')]);

    expect(result.results).toHaveLength(1);
    expect(attempts).toBe(3);
  });

  it('não retenta erro de entrada', async () => {
    const provider = new StubVisionProvider(
      () => new InvalidInputError('formato inválido'),
    );

    const service = new ImageAnalysisService(provider, {}, { retries: 3 });
    await service.analyzeBatch([makeImage('a')]);

    // Uma única chamada: retentar imagem inválida só gastaria crédito.
    expect(provider.calls).toBe(1);
  });
});

describe('ImageAnalysisService — cache', () => {
  let cache: InMemoryCacheStore;

  beforeEach(() => {
    cache = new InMemoryCacheStore();
  });

  it('reaproveita o resultado de uma imagem já analisada', async () => {
    const provider = new StubVisionProvider((image) => okOutput(image));
    const service = new ImageAnalysisService(provider, { cache });

    await service.analyzeBatch([makeImage('a', 0, 'mesmo-conteudo')]);
    const second = await service.analyzeBatch([
      makeImage('b', 0, 'mesmo-conteudo'),
    ]);

    // Conteúdo idêntico => mesmo sha256 => acerto de cache.
    expect(provider.calls).toBe(1);
    expect(second.cacheHits).toBe(1);
    expect(second.results[0]!.fromCache).toBe(true);
  });

  it('o resultado do cache assume o id da foto atual', async () => {
    const provider = new StubVisionProvider((image) => okOutput(image));
    const service = new ImageAnalysisService(provider, { cache });

    await service.analyzeBatch([makeImage('original', 0, 'x')]);
    const second = await service.analyzeBatch([makeImage('nova', 0, 'x')]);

    expect(second.results[0]!.photoId).toBe('nova');
  });

  it('conteúdo diferente não colide no cache', async () => {
    const provider = new StubVisionProvider((image) => okOutput(image));
    const service = new ImageAnalysisService(provider, { cache });

    await service.analyzeBatch([
      makeImage('a', 0, 'conteudo-a'),
      makeImage('b', 1, 'conteudo-b'),
    ]);

    expect(provider.calls).toBe(2);
  });

  it('falha do cache não derruba a análise', async () => {
    const brokenCache = {
      get: async () => {
        throw new Error('cache fora do ar');
      },
      set: async () => {
        throw new Error('cache fora do ar');
      },
      delete: async () => {},
      clear: async () => {},
    };

    const provider = new StubVisionProvider((image) => okOutput(image));
    const service = new ImageAnalysisService(provider, {
      cache: brokenCache as never,
    });

    // O get lança e vira falha da foto; o importante é não derrubar o processo.
    const result = await service.analyzeBatch([makeImage('a')]);
    expect(result.totalRequested).toBe(1);
  });
});

describe('ImageAnalysisService — custo e telemetria', () => {
  it('registra uma entrada de uso por foto bem-sucedida', async () => {
    const recorder = new NoopUsageRecorder();
    const provider = new StubVisionProvider((image) => okOutput(image));
    const service = new ImageAnalysisService(provider, {
      usageRecorder: recorder,
    });

    await service.analyzeBatch([makeImage('a'), makeImage('b')], {
      analysisId: 'analise-1',
    });

    expect(recorder.entries).toHaveLength(2);
    expect(recorder.entries[0]).toMatchObject({
      analysisId: 'analise-1',
      provider: 'stub',
      operation: 'photo-analysis',
      inputTokens: 1000,
      outputTokens: 200,
      imageCount: 1,
      success: true,
    });
  });

  it('registra também as falhas, com o código do erro', async () => {
    const recorder = new NoopUsageRecorder();
    const provider = new StubVisionProvider(() => new RateLimitError('stub'));
    const service = new ImageAnalysisService(
      provider,
      { usageRecorder: recorder },
      { retries: 0 },
    );

    await service.analyzeBatch([makeImage('a')]);

    expect(recorder.entries).toHaveLength(1);
    expect(recorder.entries[0]).toMatchObject({
      success: false,
      errorCode: 'RATE_LIMIT',
    });
  });

  it('não registra uso para foto servida do cache', async () => {
    const recorder = new NoopUsageRecorder();
    const cache = new InMemoryCacheStore();
    const provider = new StubVisionProvider((image) => okOutput(image));
    const service = new ImageAnalysisService(provider, {
      cache,
      usageRecorder: recorder,
    });

    await service.analyzeBatch([makeImage('a', 0, 'x')]);
    await service.analyzeBatch([makeImage('b', 0, 'x')]);

    // Cache não custa nada, então não gera linha de uso.
    expect(recorder.entries).toHaveLength(1);
  });

  it('informa quando o custo não pôde ser estimado', async () => {
    const provider = new StubVisionProvider((image) => okOutput(image));
    const service = new ImageAnalysisService(provider);

    // O modelo 'mock-model' tem preço zero conhecido.
    const estimate = service.estimateBatchCost(10);
    expect(estimate.pricingKnown).toBe(true);
    expect(estimate.estimatedCostUsd).toBe(0);

    const result = await service.analyzeBatch([makeImage('a')]);
    expect(result.estimatedCostUsd).toBe(0);
  });
});

describe('ImageAnalysisService — progresso', () => {
  it('reporta o progresso a cada foto, para a UI mostrar "7/24"', async () => {
    const provider = new StubVisionProvider((image) => okOutput(image));
    const service = new ImageAnalysisService(provider);
    const onProgress = vi.fn();

    await service.analyzeBatch(
      [makeImage('a', 0, 'a'), makeImage('b', 1, 'b'), makeImage('c', 2, 'c')],
      { onProgress },
    );

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.calls[0]![0]).toMatchObject({ done: 1, total: 3 });
    expect(onProgress.mock.calls[2]![0]).toMatchObject({ done: 3, total: 3 });
  });

  it('reporta progresso também para fotos que falharam', async () => {
    const provider = new StubVisionProvider(() => new ProviderError('x'));
    const service = new ImageAnalysisService(provider, {}, { retries: 0 });
    const onProgress = vi.fn();

    await service.analyzeBatch([makeImage('a')], { onProgress });

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, done: 1 }),
    );
  });
});

describe('ImageAnalysisService — paralelismo', () => {
  it('respeita o limite de fotos simultâneas', async () => {
    let active = 0;
    let peak = 0;

    const provider: VisionProvider = {
      name: 'stub',
      model: 'mock-model',
      isAvailable: async () => true,
      analyzeImage: async (image) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return okOutput(image);
      },
    };

    const service = new ImageAnalysisService(provider, {}, { concurrency: 2 });
    const images = Array.from({ length: 8 }, (_u, i) =>
      makeImage(`p${i}`, i, `conteudo-${i}`),
    );

    const result = await service.analyzeBatch(images);

    expect(result.results).toHaveLength(8);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('preserva todas as fotos independentemente da ordem de conclusão', async () => {
    const provider: VisionProvider = {
      name: 'stub',
      model: 'mock-model',
      isAvailable: async () => true,
      analyzeImage: async (image) => {
        // Inverte a ordem de conclusão em relação à de entrada.
        await new Promise((r) => setTimeout(r, (10 - image.position) * 2));
        return okOutput(image);
      },
    };

    const service = new ImageAnalysisService(provider, {}, { concurrency: 4 });
    const images = Array.from({ length: 5 }, (_u, i) =>
      makeImage(`p${i}`, i, `c${i}`),
    );

    const result = await service.analyzeBatch(images);

    expect(result.results.map((r) => r.photoId).sort()).toEqual([
      'p0', 'p1', 'p2', 'p3', 'p4',
    ]);
  });
});

describe('MockVisionProvider', () => {
  it('é determinístico: mesma imagem, mesmo resultado', async () => {
    const provider = new MockVisionProvider();
    const image = makeImage('a', 0, 'conteudo-fixo');

    const first = await provider.analyzeImage(image);
    const second = await provider.analyzeImage(image);

    expect(first.result).toEqual(second.result);
  });

  it('produz resultados diferentes para imagens diferentes', async () => {
    const provider = new MockVisionProvider();

    const a = await provider.analyzeImage(makeImage('a', 0, 'foto-a'));
    const b = await provider.analyzeImage(makeImage('b', 0, 'foto-b'));

    expect(a.result.score).not.toBe(b.result.score);
  });

  it('marca os textos como simulados', async () => {
    const provider = new MockVisionProvider();
    const output = await provider.analyzeImage(makeImage('a', 0, 'x'));

    const todos = [
      ...output.result.strengths,
      ...output.result.recommendations,
    ];

    expect(todos.length).toBeGreaterThan(0);
    for (const texto of todos) {
      expect(texto).toContain('[simulado]');
    }
  });

  it('devolve notas dentro de 0-100', async () => {
    const provider = new MockVisionProvider();

    for (let i = 0; i < 20; i++) {
      const { result } = await provider.analyzeImage(
        makeImage(`p${i}`, i, `conteudo-${i}`),
      );

      for (const value of [
        result.score, result.lighting, result.visualQuality,
        result.composition, result.professionalism,
        result.valuePerception, result.clarity,
      ]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });
});
