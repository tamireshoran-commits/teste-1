import {
  type ScoringConfig,
  DEFAULT_SCORING_CONFIG,
} from '@/server/core/analysis/scoring/config';
import {
  buildScore,
  type ScoreComponentInput,
} from '@/server/core/analysis/scoring/buildScore';
import { bandScore, clamp, normalize, safeDiv } from '@/server/core/shared/math';
import type { PricingMetrics, ScoreResult } from '@/server/core/types';

/**
 * Pricing Score (0-100).
 *
 * Cada componente devolve, além da nota, a **razão** em texto — o produto
 * precisa explicar o porquê do score, não apenas exibir o número. Componente
 * sem dado é marcado indisponível e tem o peso redistribuído (ver buildScore).
 */
export function computePricingScore(
  metrics: PricingMetrics,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
): ScoreResult {
  const weights = config.weights.pricing;
  const thresholds = config.pricingThresholds;

  const components: ScoreComponentInput[] = [
    scoreRecommendationAlignment(metrics, weights.recommendationAlignment, thresholds),
    scoreWeekdayDifferentiation(metrics, weights.weekdayDifferentiation, thresholds),
    scoreOccupancyHealth(metrics, weights.occupancyHealth, thresholds),
    scorePriceRangeDiscipline(metrics, weights.priceRangeDiscipline),
    scoreGapManagement(metrics, weights.gapManagement, thresholds),
    scoreDiscountDiscipline(metrics, weights.discountDiscipline, thresholds),
    scoreDataCompleteness(metrics, weights.dataCompleteness),
  ];

  return buildScore(components, config.version);
}

/** Quão perto o preço praticado está do recomendado pelo PriceLabs. */
function scoreRecommendationAlignment(
  metrics: PricingMetrics,
  weight: number,
  thresholds: ScoringConfig['pricingThresholds'],
): ScoreComponentInput {
  const base = {
    key: 'recommendationAlignment',
    label: 'Aderência ao preço recomendado',
    weight,
  };

  const delta = metrics.priceVsRecommendedPct;

  if (!delta.available || delta.value === null) {
    return {
      ...base,
      score: null,
      available: false,
      reason:
        'O CSV não traz preço recomendado, então a aderência não pôde ser avaliada.',
    };
  }

  const absDelta = Math.abs(delta.value);
  const tolerance = thresholds.recommendedTolerancePct;

  // Dentro da tolerância = nota cheia; degrada até zero a 3x a tolerância.
  const score =
    absDelta <= tolerance
      ? 100
      : 100 * (1 - normalize(absDelta, tolerance, tolerance * 3));

  const direction = delta.value < 0 ? 'abaixo' : 'acima';
  const below = metrics.daysBelowRecommended.value ?? 0;
  const above = metrics.daysAboveRecommended.value ?? 0;

  const reason =
    absDelta <= tolerance
      ? `Preço praticado está em média ${absDelta.toFixed(1)}% do recomendado, ` +
        `dentro da tolerância de ${tolerance}%.`
      : `Preço praticado está em média ${absDelta.toFixed(1)}% ${direction} do ` +
        `recomendado (${below} dia(s) abaixo, ${above} dia(s) acima).`;

  return { ...base, score, available: true, reason };
}

/** Diferenciação de preço entre fim de semana e dias de semana. */
function scoreWeekdayDifferentiation(
  metrics: PricingMetrics,
  weight: number,
  thresholds: ScoringConfig['pricingThresholds'],
): ScoreComponentInput {
  const base = {
    key: 'weekdayDifferentiation',
    label: 'Diferenciação por dia da semana',
    weight,
  };

  const premium = metrics.weekendPremiumPct;

  if (!premium.available || premium.value === null) {
    return {
      ...base,
      score: null,
      available: false,
      reason:
        'Não há preços suficientes em dias úteis e finais de semana para comparar.',
    };
  }

  const score = 100 * bandScore(premium.value, thresholds.weekendPremium);

  const reason =
    premium.value < thresholds.weekendPremium.idealMin
      ? `Sexta e sábado estão apenas ${premium.value.toFixed(1)}% acima dos ` +
        `demais dias; o intervalo saudável começa em ` +
        `${thresholds.weekendPremium.idealMin}%.`
      : premium.value > thresholds.weekendPremium.idealMax
        ? `Sexta e sábado estão ${premium.value.toFixed(1)}% acima dos demais ` +
          'dias, o que pode reduzir a conversão nesses dias.'
        : `Sexta e sábado estão ${premium.value.toFixed(1)}% acima dos demais ` +
          'dias, dentro do intervalo saudável.';

  return { ...base, score, available: true, reason };
}

/** Ocupação: nem baixa demais, nem tão alta a ponto de sugerir subprecificação. */
function scoreOccupancyHealth(
  metrics: PricingMetrics,
  weight: number,
  thresholds: ScoringConfig['pricingThresholds'],
): ScoreComponentInput {
  const base = { key: 'occupancyHealth', label: 'Saúde da ocupação', weight };

  const occupancy = metrics.occupancy;

  if (!occupancy.available || occupancy.value === null) {
    return {
      ...base,
      score: null,
      available: false,
      reason: 'O CSV não traz ocupação nem status de reserva.',
    };
  }

  const score = 100 * bandScore(occupancy.value, thresholds.occupancy);
  const pct = (occupancy.value * 100).toFixed(1);

  const reason =
    occupancy.value < thresholds.occupancy.idealMin
      ? `Ocupação de ${pct}% está abaixo da faixa saudável ` +
        `(${thresholds.occupancy.idealMin * 100}%-${thresholds.occupancy.idealMax * 100}%).`
      : occupancy.value > thresholds.occupancy.idealMax
        ? `Ocupação de ${pct}% é muito alta, o que costuma indicar preço ` +
          'abaixo do que o mercado aceitaria.'
        : `Ocupação de ${pct}% está dentro da faixa saudável.`;

  return { ...base, score, available: true, reason };
}

/** Piso e teto configurados e respeitados. */
function scorePriceRangeDiscipline(
  metrics: PricingMetrics,
  weight: number,
): ScoreComponentInput {
  const base = {
    key: 'priceRangeDiscipline',
    label: 'Disciplina de piso e teto',
    weight,
  };

  const min = metrics.minPriceConfigured;
  const max = metrics.maxPriceConfigured;

  if (!min.available || !max.available || min.value === null || max.value === null) {
    return {
      ...base,
      score: null,
      available: false,
      reason: 'O CSV não traz preço mínimo e máximo configurados.',
    };
  }

  const spread = safeDiv(max.value - min.value, min.value);

  if (spread === null) {
    return {
      ...base,
      score: null,
      available: false,
      reason: 'Não foi possível calcular a amplitude entre piso e teto.',
    };
  }

  // Amplitude muito estreita (<20%) engessa o algoritmo; muito larga (>300%)
  // indica limites que na prática não limitam nada.
  const score = 100 * bandScore(spread, {
    hardMin: 0,
    idealMin: 0.2,
    idealMax: 2,
    hardMax: 3,
  });

  const reason =
    spread < 0.2
      ? `A faixa entre piso e teto é de apenas ${(spread * 100).toFixed(0)}%, ` +
        'o que dá pouca margem para o algoritmo reagir à demanda.'
      : spread > 2
        ? `A faixa entre piso e teto é de ${(spread * 100).toFixed(0)}%, ` +
          'ampla a ponto de os limites quase não atuarem.'
        : `Faixa de ${(spread * 100).toFixed(0)}% entre piso e teto dá margem ` +
          'de manobra ao algoritmo.';

  return { ...base, score, available: true, reason };
}

/** Buracos no calendário que não podem ser vendidos. */
function scoreGapManagement(
  metrics: PricingMetrics,
  weight: number,
  thresholds: ScoringConfig['pricingThresholds'],
): ScoreComponentInput {
  const base = { key: 'gapManagement', label: 'Gestão de gaps', weight };

  if (metrics.coverage.withBookingStatus === 0) {
    return {
      ...base,
      score: null,
      available: false,
      reason: 'O CSV não traz status de reserva, então gaps não são detectáveis.',
    };
  }

  const totalGaps = metrics.gaps.length;
  const orphans = metrics.orphanGaps.length;

  if (totalGaps === 0) {
    return {
      ...base,
      score: 100,
      available: true,
      reason: 'Nenhum intervalo livre entre reservas foi encontrado no período.',
    };
  }

  const orphanRatio = orphans / totalGaps;
  const score = 100 * (1 - clamp(orphanRatio / thresholds.orphanGapRatioWarning, 0, 1));

  const orphanNights = metrics.orphanGaps.reduce((acc, g) => acc + g.nights, 0);

  const reason =
    orphans === 0
      ? `${totalGaps} intervalo(s) livre(s) no calendário, nenhum deles ` +
        'inviabilizado pela estadia mínima.'
      : `${orphans} de ${totalGaps} intervalo(s) livre(s) são menores que a ` +
        `estadia mínima exigida, somando ${orphanNights} noite(s) que hoje ` +
        'não podem ser reservadas.';

  return { ...base, score, available: true, reason };
}

/** Descontos agressivos demais corroem a diária média. */
function scoreDiscountDiscipline(
  metrics: PricingMetrics,
  weight: number,
  thresholds: ScoringConfig['pricingThresholds'],
): ScoreComponentInput {
  const base = {
    key: 'discountDiscipline',
    label: 'Disciplina de descontos',
    weight,
  };

  const discount = metrics.averageDiscountPct;

  if (!discount.available || discount.value === null) {
    return {
      ...base,
      score: null,
      available: false,
      reason: 'O CSV não traz informação de desconto.',
    };
  }

  const magnitude = Math.abs(discount.value);
  const limit = thresholds.aggressiveDiscountPct;

  const score = 100 * (1 - normalize(magnitude, limit, limit * 2));

  const reason =
    magnitude <= limit
      ? `Desconto médio de ${magnitude.toFixed(1)}%, dentro do limite de ` +
        `${limit}% considerado saudável.`
      : `Desconto médio de ${magnitude.toFixed(1)}% supera o limite de ` +
        `${limit}% e tende a reduzir a diária média.`;

  return { ...base, score, available: true, reason };
}

/**
 * Completude dos dados.
 *
 * Não é uma nota sobre o imóvel, e sim sobre o arquivo enviado — quanto mais
 * completo o CSV, mais confiável o diagnóstico inteiro.
 */
function scoreDataCompleteness(
  metrics: PricingMetrics,
  weight: number,
): ScoreComponentInput {
  const c = metrics.coverage;
  const total = c.totalDays;

  if (total === 0) {
    return {
      key: 'dataCompleteness',
      label: 'Completude dos dados',
      weight,
      score: null,
      available: false,
      reason: 'Nenhum dia foi importado.',
    };
  }

  const dimensions = [
    c.withPrice,
    c.withRecommendedPrice,
    c.withOccupancy || c.withBookingStatus,
    c.withMinMax,
    c.withMinStay,
  ];

  const filled = dimensions.filter((count) => count > 0).length;
  const score = (filled / dimensions.length) * 100;

  const missing: string[] = [];
  if (c.withPrice === 0) missing.push('preço');
  if (c.withRecommendedPrice === 0) missing.push('preço recomendado');
  if (c.withOccupancy === 0 && c.withBookingStatus === 0) {
    missing.push('ocupação/status de reserva');
  }
  if (c.withMinMax === 0) missing.push('piso e teto');
  if (c.withMinStay === 0) missing.push('estadia mínima');

  const reason =
    missing.length === 0
      ? `Todas as dimensões esperadas estão presentes nos ${total} dias importados.`
      : `Faltam no CSV: ${missing.join(', ')}. O diagnóstico fica parcial.`;

  return {
    key: 'dataCompleteness',
    label: 'Completude dos dados',
    weight,
    score,
    available: true,
    reason,
  };
}
