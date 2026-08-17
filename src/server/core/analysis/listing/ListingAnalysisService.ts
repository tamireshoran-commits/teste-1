import {
  DEFAULT_SCORING_CONFIG,
  type ScoringConfig,
} from '@/server/core/analysis/scoring/config';
import { getPrompt, ACTIVE_PROMPT_VERSIONS } from '@/server/core/prompts/registry';
import type { LLMProvider } from '@/server/core/providers/ai/llm/LLMProvider';
import { buildCacheKey, sha256, type CacheStore } from '@/server/core/shared/cache';
import { estimateCost } from '@/server/core/shared/cost';
import { toAppError } from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';
import { withRetry } from '@/server/core/shared/retry';
import type { AIUsageRecorder } from '@/server/core/shared/usage';
import type {
  ListingAnalysisResult,
  ListingData,
  Platform,
} from '@/server/core/types';
import { runListingChecks } from './checks';
import { computeListingScore } from './listingScore';
import {
  differentiatorsOf,
  parseListingAnalysis,
  reviewThemesOf,
  toFindings,
  type ListingLLMAnalysis,
} from './llmSchema';

const log = logger.child('listing-analysis');

export interface ListingAnalysisOptions {
  analysisId?: string;
  /** Photo Score da Etapa 3, quando as fotos já foram analisadas. */
  photoScore?: number | null;
  /** Desliga a chamada de IA — útil para preview gratuito. */
  skipLlm?: boolean;
}

export interface ListingAnalysisDeps {
  llm?: LLMProvider;
  cache?: CacheStore;
  usageRecorder?: AIUsageRecorder;
}

export interface ListingAnalysisConfig {
  retries?: number;
  baseDelayMs?: number;
}

const DEFAULT_ANALYSIS_CONFIG = {
  retries: 2,
  baseDelayMs: 1000,
} as const satisfies Required<ListingAnalysisConfig>;

/**
 * Analisa um anúncio do Airbnb ou do Booking.com.
 *
 * Estrutura em duas camadas:
 *
 * 1. **Regras determinísticas** (`checks.ts`) — sempre rodam, custo zero,
 *    resultado reproduzível. Cobrem tamanho de título, comodidades, campos
 *    ausentes, política, reputação;
 * 2. **Leitura qualitativa por IA** — opcional. Julga o que regra não alcança:
 *    posicionamento, diferenciais, se o texto responde às dúvidas do hóspede.
 *
 * A camada 2 é **best-effort**: se a IA falhar, ficar indisponível ou devolver
 * fora do contrato, a análise entrega a camada 1 e registra o motivo. Um
 * diagnóstico parcial vale mais que erro na tela.
 */
export class ListingAnalysisService {
  private readonly retry: Required<ListingAnalysisConfig>;

  constructor(
    private readonly deps: ListingAnalysisDeps = {},
    private readonly config: ScoringConfig = DEFAULT_SCORING_CONFIG,
    retryConfig: ListingAnalysisConfig = {},
  ) {
    this.retry = { ...DEFAULT_ANALYSIS_CONFIG, ...stripUndefined(retryConfig) };
  }

  async analyze(
    listing: ListingData,
    options: ListingAnalysisOptions = {},
  ): Promise<ListingAnalysisResult> {
    const checks = runListingChecks(listing);

    const llmAnalysis = options.skipLlm
      ? null
      : await this.enrichWithLlm(listing, checks, options);

    const score = computeListingScore({
      listing,
      checks,
      photoScore: options.photoScore ?? null,
      config: this.config,
    });

    const llmFindings = llmAnalysis ? toFindings(llmAnalysis) : [];
    const themes = llmAnalysis
      ? reviewThemesOf(llmAnalysis)
      : { positive: [], negative: [] };

    const result: ListingAnalysisResult = {
      platform: listing.platform,
      score,
      // Regras primeiro: o que é verificável precede o que é julgamento.
      strengths: dedupe([
        ...checks.strengths,
        ...(llmAnalysis?.strengths ?? []),
        ...themes.positive,
      ]),
      weaknesses: dedupe([
        ...checks.findings.map((f) => f.title),
        ...(llmAnalysis?.weaknesses ?? []),
        ...themes.negative,
      ]),
      missingInfo: dedupe([
        ...checks.missingInfo,
        ...cleanMissingInfo(llmAnalysis?.missing_info ?? []),
      ]),
      problems: [...checks.findings, ...llmFindings],
      differentiators: llmAnalysis ? differentiatorsOf(llmAnalysis) : [],
      ...(llmAnalysis?.positioning !== undefined
        ? { positioning: llmAnalysis.positioning }
        : {}),
      ...(this.deps.llm && llmAnalysis
        ? { provider: this.deps.llm.name }
        : {}),
    };

    log.info('análise de anúncio concluída', {
      platform: listing.platform,
      source: listing.source,
      isMock: listing.isMock,
      score: score.score,
      problems: result.problems.length,
      llmUsed: llmAnalysis !== null,
    });

    return result;
  }

  /**
   * Camada qualitativa. Nunca lança: devolve `null` e segue.
   */
  private async enrichWithLlm(
    listing: ListingData,
    checks: ReturnType<typeof runListingChecks>,
    options: ListingAnalysisOptions,
  ): Promise<ListingLLMAnalysis | null> {
    const llm = this.deps.llm;
    if (!llm) return null;

    if (!(await llm.isAvailable())) {
      log.warn('LLM indisponível; análise segue apenas com as regras', {
        provider: llm.name,
      });
      return null;
    }

    const promptName =
      listing.platform === 'AIRBNB' ? 'airbnb-analysis' : 'booking-analysis';

    // O snapshot enviado à IA exclui campos que não ajudam no julgamento e
    // inflariam o custo em tokens.
    const listingJson = JSON.stringify(toPromptPayload(listing), null, 1);

    // O que as regras já detectaram vai junto: sem isso o modelo reescreve os
    // mesmos achados com outras palavras e o relatório fica com o mesmo
    // problema ocupando duas linhas da lista de prioridades.
    const alreadyFlaggedJson = JSON.stringify(
      checks.findings.map((f) => f.title),
    );
    const alreadyMissingJson = JSON.stringify(checks.missingInfo);

    const prompt = getPrompt(promptName, {
      listingJson,
      alreadyFlaggedJson,
      alreadyMissingJson,
    }).text;

    const cacheKey = buildCacheKey({
      operation: promptName,
      provider: llm.name,
      model: 'tier:cheap',
      promptVersion: ACTIVE_PROMPT_VERSIONS[promptName],
      // O hash cobre também os achados determinísticos: mudar a entrada do
      // prompt precisa invalidar o cache.
      inputHash: sha256(listingJson + alreadyFlaggedJson + alreadyMissingJson),
    });

    const cached = await this.deps.cache?.get<unknown>(cacheKey);

    if (cached) {
      try {
        return parseListingAnalysis(listing.platform, cached);
      } catch {
        // Cache com formato antigo: descarta e refaz.
        await this.deps.cache?.delete(cacheKey);
      }
    }

    const startedAt = Date.now();

    try {
      const response = await withRetry(
        () =>
          llm.completeJSON({
            prompt,
            // Julgar um anúncio é tarefa de extração estruturada; o modelo
            // barato dá conta e o caro não se justifica aqui.
            tier: 'cheap',
            parse: (raw) => parseListingAnalysis(listing.platform, raw),
          }),
        {
          retries: this.retry.retries,
          baseDelayMs: this.retry.baseDelayMs,
          onRetry: ({ attempt, error }) =>
            log.warn('retentando análise do anúncio', {
              platform: listing.platform,
              attempt,
              error,
            }),
        },
      );

      const cost = estimateCost({
        provider: 'GEMINI',
        model: response.model,
        inputTokens: response.usage.inputTokens ?? 0,
        outputTokens: response.usage.outputTokens ?? 0,
      });

      await this.deps.usageRecorder?.record({
        ...(options.analysisId !== undefined
          ? { analysisId: options.analysisId }
          : {}),
        provider: llm.name,
        model: response.model,
        operation: promptName,
        inputTokens: response.usage.inputTokens ?? 0,
        outputTokens: response.usage.outputTokens ?? 0,
        imageCount: 0,
        estimatedCostUsd: cost.estimatedCostUsd,
        latencyMs: Date.now() - startedAt,
        success: true,
      });

      await this.deps.cache?.set(cacheKey, response.data);

      return response.data;
    } catch (error) {
      const appError = toAppError(error);

      log.warn('enriquecimento por IA falhou; seguindo só com as regras', {
        platform: listing.platform,
        code: appError.code,
        message: appError.message,
      });

      await this.deps.usageRecorder?.record({
        ...(options.analysisId !== undefined
          ? { analysisId: options.analysisId }
          : {}),
        provider: llm.name,
        model: 'unknown',
        operation: promptName,
        inputTokens: 0,
        outputTokens: 0,
        imageCount: 0,
        estimatedCostUsd: 0,
        latencyMs: Date.now() - startedAt,
        success: false,
        errorCode: appError.code,
      });

      return null;
    }
  }
}

/**
 * Recorta o anúncio para o prompt.
 *
 * As URLs das fotos não entram: o modelo de texto não as enxerga, e mandá-las
 * só gastaria tokens. O que importa é a contagem e as legendas.
 */
function toPromptPayload(listing: ListingData): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    platform: listing.platform,
    title: listing.title ?? null,
    description: listing.description ?? null,
    propertyType: listing.propertyType ?? null,
    bedrooms: listing.bedrooms ?? null,
    bathrooms: listing.bathrooms ?? null,
    beds: listing.beds ?? null,
    maxGuests: listing.maxGuests ?? null,
    amenities: listing.amenities,
    houseRules: listing.houseRules,
    cancellationPolicy: listing.cancellationPolicy ?? null,
    checkIn: listing.checkIn ?? null,
    checkOut: listing.checkOut ?? null,
    minimumStay: listing.minimumStay ?? null,
    rating: listing.rating ?? null,
    ratingScale: listing.platform === 'AIRBNB' ? 5 : 10,
    reviewCount: listing.reviewCount ?? null,
    reviewHighlights: listing.reviewHighlights ?? null,
    photoCount: listing.photos.length,
    photoCaptions: listing.photos
      .map((p) => p.caption)
      .filter((c): c is string => c !== undefined),
  };

  if (listing.platform === 'AIRBNB') {
    payload['isSuperhost'] = listing.isSuperhost ?? null;
    payload['instantBook'] = listing.instantBook ?? null;
  } else {
    payload['roomTypes'] = listing.roomTypes ?? [];
    payload['breakfastIncluded'] = listing.breakfastIncluded ?? null;
  }

  return payload;
}

/**
 * Descarta itens de `missing_info` que são eco de nome de campo.
 *
 * Mesmo instruído a escrever em português, o modelo às vezes devolve a chave
 * crua do JSON que recebeu ("photoCaptions", "isSuperhost"). No relatório do
 * cliente isso aparece no meio de rótulos como "Horário de check-in" e não
 * significa nada para quem lê.
 *
 * O critério é conservador: só remove token único, sem espaço nem acento, em
 * camelCase ou minúsculas — formato que texto escrito por humano não tem.
 */
function cleanMissingInfo(items: readonly string[]): string[] {
  const looksLikeFieldName = (text: string): boolean =>
    /^[a-z][a-zA-Z0-9_]*$/.test(text.trim());

  return items.filter((item) => !looksLikeFieldName(item));
}

function dedupe(items: readonly string[]): string[] {
  return [...new Set(items.map((i) => i.trim()).filter((i) => i !== ''))];
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

export type { Platform };
