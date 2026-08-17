import { ImageAnalysisService } from '@/server/core/analysis/photos/ImageAnalysisService';
import {
  toImageInput,
  validateImage,
} from '@/server/core/analysis/photos/imageValidation';
import { buildPhotoSetInsights } from '@/server/core/analysis/photos/insights';
import { computePhotoScore } from '@/server/core/analysis/photos/photoScore';
import { ListingAnalysisService } from '@/server/core/analysis/listing/ListingAnalysisService';
import { PricingAnalysisService } from '@/server/core/analysis/pricing/PricingAnalysisService';
import { computeOverallScore } from '@/server/core/analysis/scoring/overallScore';
import { DEFAULT_SCORING_CONFIG } from '@/server/core/analysis/scoring/config';
import {
  getAirbnbProvider,
  getBookingProvider,
  getLLMProvider,
  getPricingProvider,
  getVisionProvider,
} from '@/server/core/providers/registry';
import { NotFoundError, toAppError, ValidationError } from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';
import type {
  ListingData,
  PhotoAnalysisResult,
  Platform,
  ScoreResult,
  StepType,
} from '@/server/core/types';
import { env } from '@/server/config/env';
import { prisma } from '@/server/db/prisma';
import { PrismaCacheStore } from '@/server/db/PrismaCacheStore';
import { PrismaUsageRecorder } from '@/server/db/PrismaUsageRecorder';

const log = logger.child('analysis-service');

/**
 * Camada de aplicação: liga o domínio ao banco e ao HTTP.
 *
 * O domínio em `core/` não conhece Prisma nem Next.js; é aqui que os dois
 * mundos se encontram. Toda operação verifica que a análise pertence ao
 * usuário — a autorização não pode ficar só na rota.
 */

export interface PhotoUpload {
  fileName: string;
  bytes: Uint8Array;
}

/** Ordem de execução do pipeline. */
const STEP_ORDER: readonly StepType[] = [
  'PRICING',
  'PHOTOS',
  'AIRBNB',
  'BOOKING',
  'RECOMMENDATIONS',
  'REPORT',
];

export class AnalysisService {
  /** Cria a propriedade e a análise, já com as etapas pendentes. */
  async create(
    userId: string,
    input: {
      name: string;
      city?: string;
      propertyType?: string;
      bedrooms?: number;
      airbnbUrl?: string;
      bookingUrl?: string;
    },
  ) {
    const property = await prisma.property.create({
      data: {
        userId,
        name: input.name,
        city: input.city ?? null,
        propertyType: input.propertyType ?? null,
        bedrooms: input.bedrooms ?? null,
        airbnbUrl: input.airbnbUrl ?? null,
        bookingUrl: input.bookingUrl ?? null,
      },
    });

    return prisma.analysis.create({
      data: {
        userId,
        propertyId: property.id,
        status: 'DRAFT',
        steps: {
          create: STEP_ORDER.map((type) => ({ type, status: 'PENDING' })),
        },
      },
      include: { steps: true, property: true },
    });
  }

  async listForUser(userId: string) {
    return prisma.analysis.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { property: true, steps: { orderBy: { type: 'asc' } } },
      take: 50,
    });
  }

  /** Carrega a análise completa, garantindo que pertence ao usuário. */
  async getForUser(analysisId: string, userId: string) {
    const analysis = await prisma.analysis.findFirst({
      where: { id: analysisId, userId },
      include: {
        property: true,
        steps: true,
        photos: { include: { result: true }, orderBy: { position: 'asc' } },
        listings: true,
        listingAnalyses: true,
        pricingAnalysis: true,
        pricingDatasets: { orderBy: { createdAt: 'desc' }, take: 1 },
        recommendations: { orderBy: { rank: 'asc' } },
        aiUsageLogs: { orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });

    if (!analysis) throw new NotFoundError('Análise', analysisId);

    return analysis;
  }

  private async assertOwnership(analysisId: string, userId: string) {
    const analysis = await prisma.analysis.findFirst({
      where: { id: analysisId, userId },
      select: { id: true, status: true },
    });

    if (!analysis) throw new NotFoundError('Análise', analysisId);
    return analysis;
  }

  // ---------------------------------------------------------------------
  // Entrada de dados
  // ---------------------------------------------------------------------

  async attachPricingCsv(
    analysisId: string,
    userId: string,
    content: string,
    fileName: string,
  ) {
    await this.assertOwnership(analysisId, userId);

    const provider = getPricingProvider();
    const dataset = await provider.load({ kind: 'csv', content, fileName });

    // Um novo envio substitui o anterior: manter os dois faria a análise usar
    // um calendário desatualizado sem o usuário perceber.
    await prisma.pricingDataset.deleteMany({ where: { analysisId } });

    await prisma.pricingDataset.create({
      data: {
        analysisId,
        source: 'CSV_PRICELABS',
        fileName: dataset.fileName ?? fileName,
        currency: dataset.currency,
        rowCount: dataset.rowCount,
        skippedCount: dataset.skippedCount,
        dateFrom: dataset.dateFrom ? new Date(dataset.dateFrom) : null,
        dateTo: dataset.dateTo ? new Date(dataset.dateTo) : null,
        columnMapping: dataset.columnMapping,
        warnings: JSON.parse(JSON.stringify(dataset.warnings)),
        rows: {
          create: dataset.rows.map((r) => ({
            date: new Date(`${r.date}T00:00:00Z`),
            price: r.price,
            recommendedPrice: r.recommendedPrice,
            minPrice: r.minPrice,
            maxPrice: r.maxPrice,
            occupancy: r.occupancy,
            booked: r.booked,
            bookings: r.bookings,
            adr: r.adr,
            revpar: r.revpar,
            leadTimeDays: r.leadTimeDays,
            minStay: r.minStay,
            season: r.season,
            events: r.events,
            adjustmentPct: r.adjustmentPct,
            weekendMarkupPct: r.weekendMarkupPct,
            discountPct: r.discountPct,
            weekday: r.weekday,
            isWeekend: r.isWeekend,
          })),
        },
      },
    });

    return {
      rowCount: dataset.rowCount,
      skippedCount: dataset.skippedCount,
      dateFrom: dataset.dateFrom,
      dateTo: dataset.dateTo,
      warnings: dataset.warnings,
    };
  }

  /**
   * Valida e registra as fotos.
   *
   * Os bytes **não são persistidos**: a análise acontece em memória e só o
   * resultado é guardado. Isso evita conta de armazenamento, mantém o deploy
   * serverless viável e não retém imagem de imóvel de cliente sem necessidade.
   * O `StorageProvider` continua disponível para quando quisermos miniaturas.
   */
  async attachPhotos(
    analysisId: string,
    userId: string,
    uploads: readonly PhotoUpload[],
  ) {
    await this.assertOwnership(analysisId, userId);

    if (uploads.length === 0) {
      throw new ValidationError('Nenhuma foto foi enviada.');
    }

    if (uploads.length > env.MAX_PHOTOS_PER_ANALYSIS) {
      throw new ValidationError(
        `Máximo de ${env.MAX_PHOTOS_PER_ANALYSIS} fotos por análise; ` +
          `foram enviadas ${uploads.length}.`,
      );
    }

    const maxSizeBytes = env.MAX_PHOTO_SIZE_MB * 1_048_576;
    const accepted: Array<{ upload: PhotoUpload; sha256: string; mime: string }> = [];
    const rejected: Array<{ fileName: string; reason: string }> = [];

    uploads.forEach((upload) => {
      try {
        const validated = validateImage(upload.bytes, {
          maxSizeBytes,
          fileName: upload.fileName,
        });
        accepted.push({
          upload,
          sha256: validated.sha256,
          mime: validated.mimeType,
        });
      } catch (error) {
        // Arquivo inválido não derruba o lote: entra na lista de recusados.
        rejected.push({
          fileName: upload.fileName,
          reason: toAppError(error).message,
        });
      }
    });

    if (accepted.length === 0) {
      throw new ValidationError(
        'Nenhuma das imagens enviadas é válida.',
        { rejected },
      );
    }

    await prisma.photo.deleteMany({ where: { analysisId } });

    await prisma.photo.createMany({
      data: accepted.map((a, index) => ({
        analysisId,
        storageKey: '',
        originalName: a.upload.fileName,
        mimeType: a.mime,
        sizeBytes: a.upload.bytes.byteLength,
        sha256: a.sha256,
        position: index,
      })),
    });

    // Os bytes ficam neste cache de processo até a etapa PHOTOS rodar.
    pendingPhotoBytes.set(
      analysisId,
      accepted.map((a, index) => ({
        position: index,
        bytes: a.upload.bytes,
        fileName: a.upload.fileName,
      })),
    );

    return { accepted: accepted.length, rejected };
  }

  async attachListing(
    analysisId: string,
    userId: string,
    platform: Platform,
    input: { url?: string; manualData?: Record<string, unknown>; useMock?: boolean },
  ) {
    await this.assertOwnership(analysisId, userId);

    const provider =
      platform === 'AIRBNB'
        ? getAirbnbProvider(input.useMock ? 'MOCK' : 'MANUAL')
        : getBookingProvider(input.useMock ? 'MOCK' : 'MANUAL');

    const listing = await provider.fetchListing({
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.manualData !== undefined
        ? { manualData: input.manualData as Partial<ListingData> }
        : {}),
      analysisId,
    });

    await prisma.listingSnapshot.upsert({
      where: { analysisId_platform: { analysisId, platform } },
      update: {
        source: listing.source,
        isMock: listing.isMock,
        externalUrl: listing.externalUrl ?? null,
        data: JSON.parse(JSON.stringify(listing)),
        capturedAt: new Date(),
      },
      create: {
        analysisId,
        platform,
        source: listing.source,
        isMock: listing.isMock,
        externalUrl: listing.externalUrl ?? null,
        data: JSON.parse(JSON.stringify(listing)),
      },
    });

    return listing;
  }

  // ---------------------------------------------------------------------
  // Execução
  // ---------------------------------------------------------------------

  /**
   * Executa as etapas pendentes.
   *
   * Etapa que falha marca `FAILED` e o pipeline **continua** — o usuário
   * recebe o que deu certo mais um botão para tentar de novo só o que falhou.
   */
  async run(analysisId: string, userId: string): Promise<void> {
    await this.assertOwnership(analysisId, userId);

    await prisma.analysis.update({
      where: { id: analysisId },
      data: { status: 'RUNNING', startedAt: new Date(), errorMessage: null },
    });

    for (const type of STEP_ORDER) {
      const step = await prisma.analysisStep.findUnique({
        where: { analysisId_type: { analysisId, type } },
      });

      if (!step || step.status === 'DONE' || step.status === 'SKIPPED') continue;

      await this.executeStep(analysisId, type);
    }

    await this.finalize(analysisId);
  }

  /** Reexecuta uma etapa isolada, sem tocar nas demais. */
  async retryStep(
    analysisId: string,
    userId: string,
    type: StepType,
  ): Promise<void> {
    await this.assertOwnership(analysisId, userId);
    await this.executeStep(analysisId, type);
    await this.finalize(analysisId);
  }

  private async executeStep(analysisId: string, type: StepType): Promise<void> {
    await prisma.analysisStep.update({
      where: { analysisId_type: { analysisId, type } },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        attempts: { increment: 1 },
        errorCode: null,
        errorMessage: null,
        message: STEP_LABELS[type],
      },
    });

    try {
      const outcome = await this.runStepBody(analysisId, type);

      await prisma.analysisStep.update({
        where: { analysisId_type: { analysisId, type } },
        data: {
          status: outcome.skipped ? 'SKIPPED' : 'DONE',
          message: outcome.message,
          result: outcome.result ?? undefined,
          finishedAt: new Date(),
          progressDone: outcome.total ?? 0,
          progressTotal: outcome.total ?? 0,
        },
      });
    } catch (error) {
      const appError = toAppError(error);

      log.warn('etapa falhou', { analysisId, type, code: appError.code });

      await prisma.analysisStep.update({
        where: { analysisId_type: { analysisId, type } },
        data: {
          status: 'FAILED',
          errorCode: appError.code,
          errorMessage: appError.message,
          finishedAt: new Date(),
        },
      });
    }
  }

  private async runStepBody(
    analysisId: string,
    type: StepType,
  ): Promise<{
    skipped: boolean;
    message: string;
    result?: object;
    total?: number;
  }> {
    switch (type) {
      case 'PRICING':
        return this.stepPricing(analysisId);
      case 'PHOTOS':
        return this.stepPhotos(analysisId);
      case 'AIRBNB':
        return this.stepListing(analysisId, 'AIRBNB');
      case 'BOOKING':
        return this.stepListing(analysisId, 'BOOKING');
      case 'RECOMMENDATIONS':
        return {
          skipped: true,
          message: 'Motor de recomendações ainda não implementado.',
        };
      case 'REPORT':
        return { skipped: false, message: 'Relatório pronto.' };
    }
  }

  private async stepPricing(analysisId: string) {
    const dataset = await prisma.pricingDataset.findFirst({
      where: { analysisId },
      include: { rows: { orderBy: { date: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });

    if (!dataset || dataset.rows.length === 0) {
      return { skipped: true, message: 'Nenhum CSV de pricing foi enviado.' };
    }

    const service = new PricingAnalysisService(getPricingProvider());

    const analysis = service.analyze({
      source: 'CSV_PRICELABS',
      currency: dataset.currency,
      rowCount: dataset.rowCount,
      skippedCount: dataset.skippedCount,
      dateFrom: dataset.dateFrom?.toISOString().slice(0, 10) ?? null,
      dateTo: dataset.dateTo?.toISOString().slice(0, 10) ?? null,
      columnMapping: (dataset.columnMapping ?? {}) as Record<string, string>,
      warnings: [],
      rows: dataset.rows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        price: r.price,
        recommendedPrice: r.recommendedPrice,
        minPrice: r.minPrice,
        maxPrice: r.maxPrice,
        occupancy: r.occupancy,
        booked: r.booked,
        bookings: r.bookings,
        adr: r.adr,
        revpar: r.revpar,
        leadTimeDays: r.leadTimeDays,
        minStay: r.minStay,
        season: r.season,
        events: (r.events ?? []) as string[],
        adjustmentPct: r.adjustmentPct,
        weekendMarkupPct: r.weekendMarkupPct,
        discountPct: r.discountPct,
        weekday: r.weekday,
        isWeekend: r.isWeekend,
        raw: {},
      })),
    });

    await prisma.pricingAnalysis.upsert({
      where: { analysisId },
      update: {
        score: analysis.score.score,
        scoreBreakdown: json(analysis.score),
        metrics: json(analysis.metrics),
        problems: json(analysis.problems),
        opportunities: json(analysis.opportunities),
      },
      create: {
        analysisId,
        score: analysis.score.score,
        scoreBreakdown: json(analysis.score),
        metrics: json(analysis.metrics),
        problems: json(analysis.problems),
        opportunities: json(analysis.opportunities),
      },
    });

    return {
      skipped: false,
      message: `Pricing analisado: ${dataset.rows.length} dias.`,
      total: dataset.rows.length,
    };
  }

  private async stepPhotos(analysisId: string) {
    const photos = await prisma.photo.findMany({
      where: { analysisId },
      orderBy: { position: 'asc' },
    });

    if (photos.length === 0) {
      return { skipped: true, message: 'Nenhuma foto foi enviada.' };
    }

    const bytesByPosition = new Map(
      (pendingPhotoBytes.get(analysisId) ?? []).map((p) => [p.position, p.bytes]),
    );

    const images = photos
      .filter((p) => bytesByPosition.has(p.position))
      .map((p) =>
        toImageInput(
          {
            data: bytesByPosition.get(p.position)!,
            mimeType: p.mimeType as never,
            extension: '',
            sizeBytes: p.sizeBytes,
            sha256: p.sha256,
          },
          { id: p.id, position: p.position, fileName: p.originalName },
        ),
      );

    if (images.length === 0) {
      return {
        skipped: true,
        message:
          'As imagens não estão mais em memória. Reenvie as fotos e execute ' +
          'a análise novamente.',
      };
    }

    const property = await prisma.analysis.findUnique({
      where: { id: analysisId },
      select: { property: true },
    });

    const service = new ImageAnalysisService(
      getVisionProvider(),
      {
        cache: new PrismaCacheStore(prisma, {
          provider: getVisionProvider().name,
          model: env.VISION_MODEL,
          operation: 'photo-analysis',
        }),
        usageRecorder: new PrismaUsageRecorder(prisma),
      },
      {
        concurrency: env.VISION_CONCURRENCY,
        retries: env.VISION_RETRIES,
        timeoutMs: env.VISION_TIMEOUT_MS,
        maxCostUsd: env.MAX_COST_PER_ANALYSIS_USD,
      },
    );

    const batch = await service.analyzeBatch(images, {
      analysisId,
      ...(property?.property
        ? {
            propertyContext: {
              ...(property.property.propertyType
                ? { propertyType: property.property.propertyType }
                : {}),
              ...(property.property.bedrooms !== null
                ? { bedrooms: property.property.bedrooms }
                : {}),
              ...(property.property.city ? { city: property.property.city } : {}),
            },
          }
        : {}),
      onProgress: ({ done, total }) => {
        void prisma.analysisStep
          .update({
            where: { analysisId_type: { analysisId, type: 'PHOTOS' } },
            data: {
              progressDone: done,
              progressTotal: total,
              message: `Analisando fotos ${done}/${total}...`,
            },
          })
          .catch(() => undefined);
      },
    });

    for (const result of batch.results) {
      await prisma.photoAnalysis.upsert({
        where: { photoId: result.photoId },
        update: photoAnalysisData(result),
        create: { photoId: result.photoId, ...photoAnalysisData(result) },
      });
    }

    for (const failure of batch.failures) {
      await prisma.photoAnalysis.upsert({
        where: { photoId: failure.photoId },
        update: {
          status: 'FAILED',
          errorCode: failure.errorCode,
          errorMessage: failure.errorMessage,
        },
        create: {
          photoId: failure.photoId,
          status: 'FAILED',
          errorCode: failure.errorCode,
          errorMessage: failure.errorMessage,
        },
      });
    }

    if (batch.results.length === 0) {
      throw new ValidationError(
        `Nenhuma das ${images.length} fotos pôde ser analisada.`,
        { failures: batch.failures },
      );
    }

    return {
      skipped: false,
      message:
        `${batch.results.length} de ${images.length} foto(s) analisada(s)` +
        `${batch.failures.length > 0 ? `, ${batch.failures.length} com falha` : ''}.`,
      total: images.length,
      result: {
        analyzed: batch.results.length,
        failed: batch.failures.length,
        cacheHits: batch.cacheHits,
      },
    };
  }

  private async stepListing(analysisId: string, platform: Platform) {
    const snapshot = await prisma.listingSnapshot.findUnique({
      where: { analysisId_platform: { analysisId, platform } },
    });

    if (!snapshot) {
      return {
        skipped: true,
        message: `Nenhum dado do ${platform === 'AIRBNB' ? 'Airbnb' : 'Booking.com'} foi informado.`,
      };
    }

    const listing = snapshot.data as unknown as ListingData;
    const photoScore = await this.currentPhotoScore(analysisId);

    const service = new ListingAnalysisService({
      llm: getLLMProvider(),
      cache: new PrismaCacheStore(prisma, {
        provider: getLLMProvider().name,
        model: env.LLM_MODEL_CHEAP,
        operation: `${platform.toLowerCase()}-analysis`,
      }),
      usageRecorder: new PrismaUsageRecorder(prisma),
    });

    const result = await service.analyze(listing, {
      analysisId,
      photoScore,
    });

    await prisma.listingAnalysis.upsert({
      where: { analysisId_platform: { analysisId, platform } },
      update: listingAnalysisData(result),
      create: { analysisId, platform, ...listingAnalysisData(result) },
    });

    return {
      skipped: false,
      message: `Anúncio analisado: ${result.score.score}/100.`,
    };
  }

  private async currentPhotoScore(analysisId: string): Promise<number | null> {
    const results = await this.loadPhotoResults(analysisId);
    if (results.length === 0) return null;

    return computePhotoScore(results, buildPhotoSetInsights(results)).score;
  }

  private async loadPhotoResults(
    analysisId: string,
  ): Promise<PhotoAnalysisResult[]> {
    const photos = await prisma.photo.findMany({
      where: { analysisId },
      include: { result: true },
      orderBy: { position: 'asc' },
    });

    return photos
      .filter((p) => p.result?.status === 'DONE' && p.result.score !== null)
      .map((p) => ({
        photoId: p.id,
        roomType: p.result!.roomType ?? 'outro',
        visualQuality: p.result!.visualQuality ?? 0,
        lighting: p.result!.lighting ?? 0,
        composition: p.result!.composition ?? 0,
        professionalism: p.result!.professionalism ?? 0,
        valuePerception: p.result!.valuePerception ?? 0,
        clarity: p.result!.clarity ?? 0,
        strengths: (p.result!.strengths ?? []) as string[],
        problems: (p.result!.problems ?? []) as string[],
        recommendations: (p.result!.recommendations ?? []) as string[],
        score: p.result!.score!,
        provider: p.result!.provider ?? 'unknown',
        model: p.result!.model ?? 'unknown',
        fromCache: p.result!.fromCache,
      }));
  }

  /** Consolida os scores e fecha a análise. */
  private async finalize(analysisId: string): Promise<void> {
    const [pricing, listings, photoResults, steps] = await Promise.all([
      prisma.pricingAnalysis.findUnique({ where: { analysisId } }),
      prisma.listingAnalysis.findMany({ where: { analysisId } }),
      this.loadPhotoResults(analysisId),
      prisma.analysisStep.findMany({ where: { analysisId } }),
    ]);

    const photoScore =
      photoResults.length > 0
        ? computePhotoScore(photoResults, buildPhotoSetInsights(photoResults))
        : null;

    const scoreOf = (platform: Platform): ScoreResult | null => {
      const found = listings.find((l) => l.platform === platform);
      return found?.scoreBreakdown
        ? (found.scoreBreakdown as unknown as ScoreResult)
        : null;
    };

    const { overall, breakdown } = computeOverallScore({
      airbnb: scoreOf('AIRBNB'),
      booking: scoreOf('BOOKING'),
      pricing: pricing?.scoreBreakdown
        ? (pricing.scoreBreakdown as unknown as ScoreResult)
        : null,
      photos: photoScore,
    });

    const failed = steps.filter((s) => s.status === 'FAILED').length;
    const executed = steps.filter((s) => s.status === 'DONE').length;

    await prisma.analysis.update({
      where: { id: analysisId },
      data: {
        status: failed > 0 ? 'PARTIAL' : executed > 0 ? 'COMPLETED' : 'FAILED',
        overallScore: overall.score,
        airbnbScore: breakdown.airbnb,
        bookingScore: breakdown.booking,
        pricingScore: breakdown.pricing,
        photoScore: breakdown.photos,
        contentScore: breakdown.content,
        reputationScore: breakdown.reputation,
        scoreBreakdown: json(overall),
        finishedAt: new Date(),
      },
    });

    log.info('análise finalizada', {
      analysisId,
      overall: overall.score,
      coverage: overall.coverage,
      failedSteps: failed,
    });
  }
}

/**
 * Bytes das fotos aguardando análise, por processo.
 *
 * Como não persistimos as imagens, elas vivem aqui entre o upload e a execução
 * da etapa. Some se o processo reiniciar — e a etapa reporta exatamente isso,
 * pedindo o reenvio, em vez de falhar sem explicação. Quando houver fila de
 * verdade, isto vira objeto em storage.
 */
const pendingPhotoBytes = new Map<
  string,
  Array<{ position: number; bytes: Uint8Array; fileName: string }>
>();

const STEP_LABELS: Record<StepType, string> = {
  PRICING: 'Analisando pricing...',
  PHOTOS: 'Analisando fotos...',
  AIRBNB: 'Analisando anúncio do Airbnb...',
  BOOKING: 'Analisando anúncio do Booking.com...',
  RECOMMENDATIONS: 'Gerando recomendações...',
  REPORT: 'Finalizando relatório...',
};

export const STEP_TITLES: Record<StepType, string> = {
  PRICING: 'Pricing',
  PHOTOS: 'Fotos',
  AIRBNB: 'Airbnb',
  BOOKING: 'Booking.com',
  RECOMMENDATIONS: 'Recomendações',
  REPORT: 'Relatório',
};

function json(value: unknown): object {
  return JSON.parse(JSON.stringify(value)) as object;
}

function photoAnalysisData(result: PhotoAnalysisResult) {
  return {
    status: 'DONE' as const,
    roomType: result.roomType,
    visualQuality: result.visualQuality,
    lighting: result.lighting,
    composition: result.composition,
    professionalism: result.professionalism,
    valuePerception: result.valuePerception,
    clarity: result.clarity,
    score: result.score,
    strengths: result.strengths,
    problems: result.problems,
    recommendations: result.recommendations,
    provider: result.provider,
    model: result.model,
    fromCache: result.fromCache,
    errorCode: null,
    errorMessage: null,
  };
}

function listingAnalysisData(result: {
  score: ScoreResult;
  strengths: string[];
  weaknesses: string[];
  missingInfo: string[];
  positioning?: string;
  provider?: string;
}) {
  return {
    score: result.score.score,
    scoreBreakdown: json(result.score),
    strengths: result.strengths,
    weaknesses: result.weaknesses,
    missingInfo: result.missingInfo,
    positioning: result.positioning ?? null,
    provider: result.provider ?? null,
  };
}

export const analysisService = new AnalysisService();
export { DEFAULT_SCORING_CONFIG };
