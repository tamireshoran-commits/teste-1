import { ACTIVE_PROMPT_VERSIONS } from '@/server/core/prompts/registry';
import type { VisionProvider } from '@/server/core/providers/ai/vision/VisionProvider';
import { buildCacheKey, type CacheStore } from '@/server/core/shared/cache';
import { mapWithConcurrency } from '@/server/core/shared/concurrency';
import { CostTracker, estimateCost } from '@/server/core/shared/cost';
import { BudgetExceededError, toAppError } from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';
import { withRetry } from '@/server/core/shared/retry';
import type { AIUsageRecorder } from '@/server/core/shared/usage';
import type {
  ImageInput,
  PhotoAnalysisFailure,
  PhotoAnalysisResult,
  PhotoBatchResult,
} from '@/server/core/types';

const log = logger.child('image-analysis');

const OPERATION = 'photo-analysis';

export interface ImageAnalysisOptions {
  analysisId?: string;
  propertyContext?: {
    propertyType?: string;
    bedrooms?: number;
    city?: string;
  };
  /** Chamado a cada foto concluída, para a UI mostrar "7/24". */
  onProgress?: (progress: {
    done: number;
    total: number;
    photoId: string;
    ok: boolean;
  }) => void;
}

export interface ImageAnalysisServiceConfig {
  /** Fotos analisadas em paralelo. Baixo de propósito: rate limit é caro. */
  concurrency?: number;
  retries?: number;
  timeoutMs?: number;
  /** TTL do cache. Padrão: 30 dias. */
  cacheTtlMs?: number;
  /** Teto de custo estimado por lote, em USD. */
  maxCostUsd?: number;
}

const DEFAULTS = {
  concurrency: 3,
  retries: 2,
  timeoutMs: 45_000,
  cacheTtlMs: 30 * 24 * 60 * 60 * 1000,
  maxCostUsd: 1,
} as const;

/**
 * Analisa um conjunto de fotos, uma chamada de IA por imagem.
 *
 * Garantias de projeto:
 * - **isolamento**: a falha de uma foto vira `PhotoAnalysisFailure` e o lote
 *   continua. Nenhuma exceção de imagem individual escapa deste serviço;
 * - **retry seletivo**: só erros marcados `retryable` (429, 5xx, timeout) são
 *   retentados, com backoff exponencial. Imagem inválida falha na hora;
 * - **cache**: chave = sha256 da imagem + modelo + versão do prompt, então
 *   reanalisar o mesmo álbum só cobra pelas fotos novas;
 * - **orçamento**: ao atingir o teto, as fotos restantes falham com
 *   `BUDGET_EXCEEDED` em vez de estourar a conta silenciosamente.
 */
export class ImageAnalysisService {
  private readonly config: Required<ImageAnalysisServiceConfig>;

  constructor(
    private readonly provider: VisionProvider,
    private readonly deps: {
      cache?: CacheStore;
      usageRecorder?: AIUsageRecorder;
    } = {},
    config: ImageAnalysisServiceConfig = {},
  ) {
    this.config = { ...DEFAULTS, ...stripUndefined(config) };
  }

  async analyzeBatch(
    images: readonly ImageInput[],
    options: ImageAnalysisOptions = {},
  ): Promise<PhotoBatchResult> {
    const costTracker = new CostTracker(this.config.maxCostUsd);
    const results: PhotoAnalysisResult[] = [];
    const failures: PhotoAnalysisFailure[] = [];

    let done = 0;
    let cacheHits = 0;

    const settled = await mapWithConcurrency(
      images,
      this.config.concurrency,
      async (image) => this.analyzeOne(image, options, costTracker),
    );

    settled.forEach((outcome, index) => {
      const image = images[index]!;
      done++;

      if (outcome.ok) {
        results.push(outcome.value);
        if (outcome.value.fromCache) cacheHits++;
      } else {
        const error = toAppError(outcome.error);

        failures.push({
          photoId: image.id,
          errorCode: error.code,
          errorMessage: error.message,
          retryable: error.retryable,
        });

        log.warn('foto falhou; lote continua', {
          photoId: image.id,
          code: error.code,
        });
      }

      options.onProgress?.({
        done,
        total: images.length,
        photoId: image.id,
        ok: outcome.ok,
      });
    });

    log.info('lote de fotos concluído', {
      analysisId: options.analysisId,
      total: images.length,
      ok: results.length,
      failed: failures.length,
      cacheHits,
      estimatedCostUsd: costTracker.totalUsd,
    });

    return {
      results,
      failures,
      totalRequested: images.length,
      cacheHits,
      estimatedCostUsd: costTracker.totalUsd,
    };
  }

  /** Reprocessa uma única foto — usado pelo retry granular da UI. */
  async analyzeSingle(
    image: ImageInput,
    options: ImageAnalysisOptions = {},
  ): Promise<PhotoAnalysisResult> {
    return this.analyzeOne(
      image,
      options,
      new CostTracker(this.config.maxCostUsd),
    );
  }

  private async analyzeOne(
    image: ImageInput,
    options: ImageAnalysisOptions,
    costTracker: CostTracker,
  ): Promise<PhotoAnalysisResult> {
    const cacheKey = buildCacheKey({
      operation: OPERATION,
      provider: this.provider.name,
      model: this.provider.model,
      promptVersion: ACTIVE_PROMPT_VERSIONS['photo-analysis'],
      inputHash: image.sha256,
    });

    const cached = await this.deps.cache?.get<PhotoAnalysisResult>(cacheKey);

    if (cached) {
      log.debug('cache hit', { photoId: image.id });
      // photoId do cache vem de outra análise; o que importa é o conteúdo.
      return { ...cached, photoId: image.id, fromCache: true };
    }

    // Só barra quando já houve gasto: a primeira foto sempre tem chance de
    // rodar, senão um teto mal configurado bloquearia a análise inteira.
    if (costTracker.totalUsd > 0 && costTracker.remainingUsd <= 0) {
      throw new BudgetExceededError(
        costTracker.totalUsd,
        this.config.maxCostUsd,
      );
    }

    const startedAt = Date.now();

    try {
      const output = await withRetry(
        () =>
          this.provider.analyzeImage(image, {
            timeoutMs: this.config.timeoutMs,
            ...(options.propertyContext !== undefined
              ? { propertyContext: options.propertyContext }
              : {}),
          }),
        {
          retries: this.config.retries,
          baseDelayMs: 1000,
          maxDelayMs: 20_000,
          onRetry: ({ attempt, delayMs, error }) => {
            log.warn('retentando análise da foto', {
              photoId: image.id,
              attempt,
              delayMs,
              error,
            });
          },
        },
      );

      const cost = costTracker.record({
        provider: this.provider.name.toUpperCase() as never,
        model: this.provider.model,
        inputTokens: output.usage.inputTokens ?? 0,
        outputTokens: output.usage.outputTokens ?? 0,
        imageCount: output.usage.imageCount,
      });

      await this.deps.usageRecorder?.record({
        ...(options.analysisId !== undefined
          ? { analysisId: options.analysisId }
          : {}),
        provider: this.provider.name,
        model: this.provider.model,
        operation: OPERATION,
        inputTokens: output.usage.inputTokens ?? 0,
        outputTokens: output.usage.outputTokens ?? 0,
        imageCount: output.usage.imageCount,
        estimatedCostUsd: cost.estimatedCostUsd,
        latencyMs: Date.now() - startedAt,
        success: true,
      });

      if (cost.warning) {
        log.warn('custo não estimado', {
          model: this.provider.model,
          warning: cost.warning,
        });
      }

      const result: PhotoAnalysisResult = {
        ...output.result,
        provider: this.provider.name,
        model: this.provider.model,
        fromCache: false,
      };

      await this.deps.cache?.set(cacheKey, result, this.config.cacheTtlMs);

      return result;
    } catch (error) {
      const appError = toAppError(error);

      // Registra a falha: tentativas que consumiram tokens custaram dinheiro,
      // e omiti-las subestimaria o gasto real da análise.
      await this.deps.usageRecorder?.record({
        ...(options.analysisId !== undefined
          ? { analysisId: options.analysisId }
          : {}),
        provider: this.provider.name,
        model: this.provider.model,
        operation: OPERATION,
        inputTokens: 0,
        outputTokens: 0,
        imageCount: 1,
        estimatedCostUsd: 0,
        latencyMs: Date.now() - startedAt,
        success: false,
        errorCode: appError.code,
      });

      throw appError;
    }
  }

  /** Custo estimado de analisar N fotos, para avisar antes de começar. */
  estimateBatchCost(
    photoCount: number,
    averageInputTokens = 1500,
    averageOutputTokens = 350,
  ): { estimatedCostUsd: number; pricingKnown: boolean } {
    const perPhoto = estimateCost({
      provider: this.provider.name.toUpperCase() as never,
      model: this.provider.model,
      inputTokens: averageInputTokens,
      outputTokens: averageOutputTokens,
      imageCount: 1,
    });

    return {
      estimatedCostUsd: perPhoto.estimatedCostUsd * photoCount,
      pricingKnown: perPhoto.pricingKnown,
    };
  }
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
