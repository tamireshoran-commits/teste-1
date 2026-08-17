import {
  DEFAULT_SCORING_CONFIG,
  type ScoringConfig,
} from '@/server/core/analysis/scoring/config';
import type { PricingDataProvider } from '@/server/core/providers/pricing/PricingDataProvider';
import { logger } from '@/server/core/shared/logger';
import type {
  PricingAnalysisResult,
  PricingDataset,
} from '@/server/core/types';
import {
  buildPricingSummary,
  detectPricingOpportunities,
  detectPricingProblems,
} from './findings';
import { computePricingMetrics } from './metrics';
import { computePricingScore } from './pricingScore';

const log = logger.child('pricing-analysis');

/**
 * Orquestra a análise de pricing: carrega o dataset pelo provider, calcula as
 * métricas, aplica as regras e monta o score.
 *
 * O serviço depende da *interface* `PricingDataProvider`, não do CSV: quando a
 * API do PriceLabs estiver disponível, basta injetar o outro provider.
 */
export class PricingAnalysisService {
  constructor(
    private readonly provider: PricingDataProvider,
    private readonly config: ScoringConfig = DEFAULT_SCORING_CONFIG,
  ) {}

  /** Carrega o dataset pela origem configurada e analisa. */
  async analyzeFromCsv(
    content: string,
    fileName?: string,
  ): Promise<{ dataset: PricingDataset; analysis: PricingAnalysisResult }> {
    const dataset = await this.provider.load({
      kind: 'csv',
      content,
      ...(fileName !== undefined ? { fileName } : {}),
    });

    return { dataset, analysis: this.analyze(dataset) };
  }

  /** Analisa um dataset já carregado. Puro: sem I/O, fácil de testar. */
  analyze(dataset: PricingDataset): PricingAnalysisResult {
    const metrics = computePricingMetrics(dataset);
    const score = computePricingScore(metrics, this.config);
    const problems = detectPricingProblems(metrics, dataset, this.config);
    const opportunities = detectPricingOpportunities(metrics, this.config);

    log.info('análise de pricing concluída', {
      days: dataset.rowCount,
      score: score.score,
      coverage: score.coverage,
      problems: problems.length,
      opportunities: opportunities.length,
      warnings: dataset.warnings.length,
    });

    return {
      metrics,
      score,
      problems,
      opportunities,
      summary: buildPricingSummary(score.score, problems, metrics),
    };
  }
}
