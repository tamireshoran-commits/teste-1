/**
 * Configuração de pesos do scoring.
 *
 * Item 10 da especificação: o cálculo mora no backend e é configurável — o
 * frontend só exibe o resultado. Os pesos são versionados para que análises
 * antigas continuem explicáveis mesmo depois de a fórmula mudar.
 */

export interface ScoringWeights {
  /** Peso de cada score no Overall Competitiveness Score. */
  overall: {
    airbnb: number;
    booking: number;
    pricing: number;
    photos: number;
    content: number;
    reputation: number;
  };
  /** Componentes internos do Pricing Score. */
  pricing: {
    recommendationAlignment: number;
    weekdayDifferentiation: number;
    occupancyHealth: number;
    priceRangeDiscipline: number;
    gapManagement: number;
    discountDiscipline: number;
    dataCompleteness: number;
  };
  /** Componentes internos do Photo Score (usados na Etapa 3). */
  photos: {
    coverPhoto: number;
    averageQuality: number;
    variety: number;
    roomCoverage: number;
    ordering: number;
    professionalism: number;
    valuePerception: number;
  };
  /** Componentes internos do Airbnb Score (Etapa 4). */
  airbnb: {
    content: number;
    photos: number;
    amenities: number;
    reputation: number;
    presentation: number;
    competitiveness: number;
  };
  /** Componentes internos do Booking Score (Etapa 4). */
  booking: {
    content: number;
    photos: number;
    amenities: number;
    reputation: number;
    policies: number;
    competitiveness: number;
  };
}

export interface ScoringConfig {
  version: string;
  weights: ScoringWeights;
  /** Parâmetros das heurísticas de pricing, também configuráveis. */
  pricingThresholds: PricingThresholds;
}

export interface PricingThresholds {
  /** Tolerância, em %, para o preço ser considerado alinhado ao recomendado. */
  recommendedTolerancePct: number;
  /** Faixa saudável de prêmio de fim de semana, em %. */
  weekendPremium: { hardMin: number; idealMin: number; idealMax: number; hardMax: number };
  /** Faixa saudável de ocupação (fração 0..1). */
  occupancy: { hardMin: number; idealMin: number; idealMax: number; hardMax: number };
  /** Acima disso, o desconto é considerado agressivo demais. */
  aggressiveDiscountPct: number;
  /** Proporção de orphan gaps a partir da qual vira problema. */
  orphanGapRatioWarning: number;
  /** Mínimo de dias para uma métrica sazonal ser considerada confiável. */
  minDaysForSeasonality: number;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  version: 'v1',
  weights: {
    overall: {
      airbnb: 20,
      booking: 10,
      pricing: 25,
      photos: 20,
      content: 15,
      reputation: 10,
    },
    pricing: {
      recommendationAlignment: 25,
      weekdayDifferentiation: 15,
      occupancyHealth: 20,
      priceRangeDiscipline: 10,
      gapManagement: 10,
      discountDiscipline: 10,
      dataCompleteness: 10,
    },
    photos: {
      coverPhoto: 20,
      averageQuality: 25,
      variety: 10,
      roomCoverage: 15,
      ordering: 10,
      professionalism: 10,
      valuePerception: 10,
    },
    airbnb: {
      content: 25,
      photos: 25,
      amenities: 15,
      reputation: 15,
      presentation: 10,
      competitiveness: 10,
    },
    booking: {
      content: 25,
      photos: 25,
      amenities: 15,
      reputation: 15,
      policies: 10,
      competitiveness: 10,
    },
  },
  pricingThresholds: {
    recommendedTolerancePct: 7,
    weekendPremium: { hardMin: -5, idealMin: 10, idealMax: 40, hardMax: 80 },
    occupancy: { hardMin: 0.15, idealMin: 0.55, idealMax: 0.85, hardMax: 1 },
    aggressiveDiscountPct: 25,
    orphanGapRatioWarning: 0.2,
    minDaysForSeasonality: 60,
  },
};

/** Valida que um conjunto de pesos soma um total positivo. */
export function assertPositiveWeights(
  weights: Record<string, number>,
  label: string,
): void {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);

  if (total <= 0) {
    throw new Error(`Pesos de "${label}" devem somar mais que zero.`);
  }
}
