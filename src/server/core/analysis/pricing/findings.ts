import type { ScoringConfig } from '@/server/core/analysis/scoring/config';
import { WEEKDAY_LABELS } from '@/server/core/providers/pricing/csv/dates';
import { compact, mean } from '@/server/core/shared/math';
import type {
  Finding,
  Opportunity,
  PricingDataset,
  PricingMetrics,
} from '@/server/core/types';

/**
 * Regras determinísticas que traduzem métricas em problemas e oportunidades.
 *
 * Nenhuma delas promete resultado financeiro: por decisão de produto, toda
 * oportunidade carrega um `framing` de hipótese. O texto que chega ao usuário
 * diz "oportunidade potencial", nunca "você vai faturar mais".
 */

export function detectPricingProblems(
  metrics: PricingMetrics,
  dataset: PricingDataset,
  config: ScoringConfig,
): Finding[] {
  const problems: Finding[] = [];
  const t = config.pricingThresholds;

  const delta = metrics.priceVsRecommendedPct;
  if (delta.available && delta.value !== null && delta.value < -t.recommendedTolerancePct) {
    problems.push({
      code: 'BELOW_RECOMMENDED',
      title: 'Preço abaixo do recomendado',
      detail:
        `O preço praticado está em média ${Math.abs(delta.value).toFixed(1)}% ` +
        `abaixo do recomendado pelo PriceLabs, em ` +
        `${metrics.daysBelowRecommended.value ?? 0} dia(s) do período.`,
      severity: Math.abs(delta.value) > t.recommendedTolerancePct * 2 ? 'HIGH' : 'MEDIUM',
      evidence: {
        averageDeltaPct: delta.value,
        daysBelowRecommended: metrics.daysBelowRecommended.value,
        sampleSize: delta.sampleSize,
      },
    });
  }

  if (delta.available && delta.value !== null && delta.value > t.recommendedTolerancePct * 2) {
    problems.push({
      code: 'FAR_ABOVE_RECOMMENDED',
      title: 'Preço muito acima do recomendado',
      detail:
        `O preço praticado está em média ${delta.value.toFixed(1)}% acima do ` +
        'recomendado. Preços muito acima da referência podem reduzir a ' +
        'conversão se não houver diferencial que os sustente.',
      severity: 'MEDIUM',
      evidence: {
        averageDeltaPct: delta.value,
        daysAboveRecommended: metrics.daysAboveRecommended.value,
      },
    });
  }

  const premium = metrics.weekendPremiumPct;
  if (premium.available && premium.value !== null && premium.value < t.weekendPremium.idealMin) {
    problems.push({
      code: 'LOW_WEEKEND_DIFFERENTIATION',
      title: 'Baixa diferenciação entre dias úteis e fim de semana',
      detail:
        `Sexta e sábado estão apenas ${premium.value.toFixed(1)}% acima dos ` +
        `demais dias. A referência de mercado costuma ficar entre ` +
        `${t.weekendPremium.idealMin}% e ${t.weekendPremium.idealMax}%.`,
      severity: premium.value < 0 ? 'HIGH' : 'MEDIUM',
      evidence: { weekendPremiumPct: premium.value },
    });
  }

  const occupancy = metrics.occupancy;
  if (occupancy.available && occupancy.value !== null) {
    if (occupancy.value > t.occupancy.idealMax) {
      problems.push({
        code: 'OCCUPANCY_TOO_HIGH',
        title: 'Ocupação muito alta para o preço praticado',
        detail:
          `A ocupação de ${(occupancy.value * 100).toFixed(1)}% está acima da ` +
          `faixa saudável (até ${t.occupancy.idealMax * 100}%). Ocupação ` +
          'próxima do total costuma indicar que há espaço para testar preços ' +
          'mais altos.',
        severity: 'MEDIUM',
        evidence: { occupancy: occupancy.value },
      });
    } else if (occupancy.value < t.occupancy.idealMin) {
      problems.push({
        code: 'OCCUPANCY_TOO_LOW',
        title: 'Ocupação abaixo do esperado',
        detail:
          `A ocupação de ${(occupancy.value * 100).toFixed(1)}% está abaixo da ` +
          `faixa saudável (a partir de ${t.occupancy.idealMin * 100}%).`,
        severity: occupancy.value < t.occupancy.hardMin ? 'HIGH' : 'MEDIUM',
        evidence: { occupancy: occupancy.value },
      });
    }
  }

  const discount = metrics.averageDiscountPct;
  if (discount.available && discount.value !== null &&
      Math.abs(discount.value) > t.aggressiveDiscountPct) {
    problems.push({
      code: 'AGGRESSIVE_DISCOUNT',
      title: 'Desconto elevado',
      detail:
        `O desconto médio de ${Math.abs(discount.value).toFixed(1)}% supera o ` +
        `limite de ${t.aggressiveDiscountPct}% adotado como referência e ` +
        'pressiona a diária média para baixo.',
      severity: 'MEDIUM',
      evidence: { averageDiscountPct: discount.value },
    });
  }

  if (metrics.orphanGaps.length > 0) {
    const nights = metrics.orphanGaps.reduce((acc, g) => acc + g.nights, 0);
    problems.push({
      code: 'ORPHAN_GAPS',
      title: 'Intervalos órfãos no calendário',
      detail:
        `${metrics.orphanGaps.length} intervalo(s) entre reservas somam ` +
        `${nights} noite(s) que não podem ser reservadas porque são menores ` +
        'que a estadia mínima exigida nesses dias.',
      severity: nights > 5 ? 'HIGH' : 'MEDIUM',
      evidence: {
        orphanGapCount: metrics.orphanGaps.length,
        orphanNights: nights,
        gaps: metrics.orphanGaps.slice(0, 5),
      },
    });
  }

  const lowCoverage = metrics.coverage.totalDays > 0 &&
    metrics.coverage.withPrice / metrics.coverage.totalDays < 0.5;

  if (lowCoverage) {
    problems.push({
      code: 'SPARSE_PRICE_DATA',
      title: 'Poucos dias com preço informado',
      detail:
        `Apenas ${metrics.coverage.withPrice} de ${metrics.coverage.totalDays} ` +
        'dias trazem preço. As métricas de diária ficam pouco representativas.',
      severity: 'MEDIUM',
      evidence: {
        withPrice: metrics.coverage.withPrice,
        totalDays: metrics.coverage.totalDays,
      },
    });
  }

  if (dataset.rows.length < t.minDaysForSeasonality) {
    problems.push({
      code: 'SHORT_PERIOD',
      title: 'Período curto para leitura sazonal',
      detail:
        `O arquivo cobre ${dataset.rows.length} dia(s). Abaixo de ` +
        `${t.minDaysForSeasonality} dias, a leitura de sazonalidade é apenas ` +
        'indicativa.',
      severity: 'LOW',
      evidence: { days: dataset.rows.length },
    });
  }

  return problems;
}

export function detectPricingOpportunities(
  metrics: PricingMetrics,
  config: ScoringConfig,
): Opportunity[] {
  const opportunities: Opportunity[] = [];
  const t = config.pricingThresholds;

  const delta = metrics.priceVsRecommendedPct;
  const occupancy = metrics.occupancy;

  // Preço abaixo do recomendado + ocupação alta = sinal mais forte de que há
  // espaço para subir. Os dois sinais juntos, nunca um isolado.
  if (
    delta.available && delta.value !== null && delta.value < -t.recommendedTolerancePct &&
    occupancy.available && occupancy.value !== null && occupancy.value > t.occupancy.idealMin
  ) {
    opportunities.push({
      code: 'RAISE_PRICE_HIGH_DEMAND',
      title: 'Oportunidade de elevar preços em períodos de alta demanda',
      detail:
        `O preço está ${Math.abs(delta.value).toFixed(1)}% abaixo do recomendado ` +
        `enquanto a ocupação é de ${(occupancy.value * 100).toFixed(1)}%. ` +
        'A combinação sugere espaço para testar valores mais altos.',
      impact: 'HIGH',
      framing: 'oportunidade potencial',
      evidence: {
        averageDeltaPct: delta.value,
        occupancy: occupancy.value,
      },
    });
  }

  const premium = metrics.weekendPremiumPct;
  if (premium.available && premium.value !== null && premium.value < t.weekendPremium.idealMin) {
    const weekendDays = metrics.priceByWeekday.filter((d) => d.weekday === 5 || d.weekday === 6);

    opportunities.push({
      code: 'INCREASE_WEEKEND_PRICE',
      title: 'Aumentar preço de sexta e sábado',
      detail:
        'A diferença atual entre fim de semana e dias úteis é de ' +
        `${premium.value.toFixed(1)}%. Elevar sexta e sábado aproximaria o ` +
        `anúncio da faixa de referência (${t.weekendPremium.idealMin}%-` +
        `${t.weekendPremium.idealMax}%).`,
      impact: 'HIGH',
      framing: 'recomendação',
      evidence: {
        weekendPremiumPct: premium.value,
        weekendAveragePrice: mean(weekendDays.map((d) => d.averagePrice)),
      },
    });
  }

  // Dias úteis com preço acima da média e ocupação baixa: candidatos a redução.
  const weakWeekdays = metrics.priceByWeekday.filter(
    (d) =>
      d.weekday >= 0 && d.weekday <= 2 &&
      d.averageOccupancy !== null &&
      d.averageOccupancy < t.occupancy.idealMin &&
      d.days > 0,
  );

  if (weakWeekdays.length > 0) {
    opportunities.push({
      code: 'REDUCE_LOW_DEMAND_WEEKDAYS',
      title: 'Revisar preço de domingo a terça em baixa demanda',
      detail:
        `${weakWeekdays.map((d) => d.label).join(', ')} apresentam ocupação ` +
        `abaixo de ${t.occupancy.idealMin * 100}%. Reduzir o preço nesses dias ` +
        'é uma hipótese para melhorar o preenchimento do calendário.',
      impact: 'MEDIUM',
      framing: 'hipótese',
      evidence: {
        days: weakWeekdays.map((d) => ({
          label: d.label,
          occupancy: d.averageOccupancy,
          averagePrice: d.averagePrice,
        })),
      },
    });
  }

  // Desconto de última hora fora da curva em relação às demais janelas.
  const lastMinute = metrics.leadTimeBuckets.find((b) => b.minDays === 0);
  const others = metrics.leadTimeBuckets.filter((b) => b.minDays > 0);
  const othersAvgDiscount = mean(others.map((b) => b.averageDiscountPct));

  if (
    lastMinute?.averageDiscountPct != null &&
    othersAvgDiscount !== null &&
    Math.abs(lastMinute.averageDiscountPct) > Math.abs(othersAvgDiscount) * 1.5 &&
    Math.abs(lastMinute.averageDiscountPct) > t.aggressiveDiscountPct
  ) {
    opportunities.push({
      code: 'REVIEW_LAST_MINUTE_DISCOUNT',
      title: 'Revisar desconto para reservas de última hora',
      detail:
        `A janela de última hora tem desconto médio de ` +
        `${Math.abs(lastMinute.averageDiscountPct).toFixed(1)}%, contra ` +
        `${Math.abs(othersAvgDiscount).toFixed(1)}% nas demais janelas. ` +
        'Reduzir essa diferença é uma hipótese para proteger a diária média.',
      impact: 'MEDIUM',
      framing: 'hipótese',
      evidence: {
        lastMinuteDiscountPct: lastMinute.averageDiscountPct,
        otherWindowsDiscountPct: othersAvgDiscount,
      },
    });
  }

  if (metrics.orphanGaps.length > 0) {
    opportunities.push({
      code: 'FIX_ORPHAN_GAPS',
      title: 'Ajustar estadia mínima nos intervalos órfãos',
      detail:
        `Reduzir a estadia mínima nas ${metrics.orphanGaps.length} janela(s) ` +
        'órfã(s) as tornaria reserváveis. É a mudança de menor esforço entre ' +
        'as identificadas.',
      impact: 'MEDIUM',
      framing: 'recomendação',
      evidence: { gaps: metrics.orphanGaps.slice(0, 5) },
    });
  }

  // Eventos precificados como dia comum.
  const underpricedEvents = metrics.events.filter(
    (e) => e.premiumVsBaselinePct !== null && e.premiumVsBaselinePct < 5,
  );

  if (underpricedEvents.length > 0) {
    opportunities.push({
      code: 'PRICE_EVENTS',
      title: 'Precificar datas com eventos',
      detail:
        `${underpricedEvents.length} data(s) com evento estão precificadas ` +
        'praticamente como um dia comum do mesmo mês. Revisar esses dias é ' +
        'uma oportunidade potencial.',
      impact: 'MEDIUM',
      framing: 'oportunidade potencial',
      evidence: {
        dates: underpricedEvents.slice(0, 10).map((e) => ({
          date: e.date,
          events: e.events,
          premiumVsBaselinePct: e.premiumVsBaselinePct,
        })),
      },
    });
  }

  return opportunities;
}

/** Resumo textual do score, em linguagem de hipótese. */
export function buildPricingSummary(
  score: number,
  problems: readonly Finding[],
  metrics: PricingMetrics,
): string {
  const parts: string[] = [`Pricing Score: ${score}/100.`];

  const highs = problems.filter((p) => p.severity === 'HIGH');

  if (highs.length > 0) {
    parts.push(
      `Principais pontos de atenção: ${highs.map((p) => p.title.toLowerCase()).join('; ')}.`,
    );
  } else if (problems.length > 0) {
    parts.push(
      `Pontos de atenção de menor severidade: ` +
        `${problems.slice(0, 3).map((p) => p.title.toLowerCase()).join('; ')}.`,
    );
  } else {
    parts.push('Nenhum problema relevante foi detectado nas regras aplicadas.');
  }

  const coverage = metrics.coverage;
  const priceCoverage = coverage.totalDays > 0
    ? (coverage.withPrice / coverage.totalDays) * 100
    : 0;

  parts.push(
    `Análise baseada em ${coverage.totalDays} dia(s), ` +
      `${priceCoverage.toFixed(0)}% deles com preço informado. ` +
      'Os valores são estimativas a partir do arquivo enviado.',
  );

  return parts.join(' ');
}

/** Dias da semana com preço médio, para exibição no relatório. */
export function summarizeWeekdayPricing(metrics: PricingMetrics): string[] {
  return metrics.priceByWeekday
    .filter((d) => d.averagePrice !== null)
    .map(
      (d) =>
        `${WEEKDAY_LABELS[d.weekday]}: ${d.averagePrice!.toFixed(2)} ` +
        `(${d.days} dia(s))`,
    );
}

/** Média de uma lista de métricas opcionais, ignorando ausentes. */
export function averageAvailable(
  values: readonly (number | null | undefined)[],
): number | null {
  return compact(values).length > 0 ? mean(values) : null;
}
