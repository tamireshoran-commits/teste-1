import {
  daysBetween,
  monthOf,
  WEEKDAY_LABELS,
} from '@/server/core/providers/pricing/csv/dates';
import {
  compact,
  maxOf,
  mean,
  median,
  minOf,
  round,
  safeDiv,
  sum,
} from '@/server/core/shared/math';
import type {
  CalendarGap,
  EventImpact,
  LeadTimeBucket,
  Metric,
  MonthlyBreakdown,
  PricingDataCoverage,
  PricingDataset,
  PricingDayRow,
  PricingMetrics,
  WeekdayPrice,
} from '@/server/core/types';

/**
 * Cálculo determinístico das métricas de pricing.
 *
 * Nenhuma IA participa desta etapa: são contas sobre o CSV. Isso mantém o
 * custo em zero, o resultado reproduzível e os números auditáveis — a IA
 * entra depois apenas para *interpretar* o que foi calculado aqui.
 */

function metric(
  value: number | null,
  sampleSize: number,
  unit?: string,
  note?: string,
): Metric {
  return {
    value: round(value, 2),
    available: value !== null && sampleSize > 0,
    sampleSize,
    ...(unit !== undefined ? { unit } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

const unavailable = (note: string): Metric => ({
  value: null,
  available: false,
  sampleSize: 0,
  note,
});

export function computePricingMetrics(
  dataset: PricingDataset,
): PricingMetrics {
  const rows = dataset.rows;
  const coverage = computeCoverage(rows);

  const bookedRows = rows.filter((r) => r.booked === true);
  const hasBookingStatus = coverage.withBookingStatus > 0;

  return {
    ...computeCoreMetrics(rows, bookedRows, hasBookingStatus),
    ...computePriceVsRecommended(rows),
    ...computeWeekendMetrics(rows),
    priceByWeekday: computePriceByWeekday(rows),
    monthly: computeMonthly(rows, hasBookingStatus),
    leadTimeBuckets: computeLeadTimeBuckets(rows),
    ...computeGapMetrics(rows, hasBookingStatus),
    events: computeEventImpacts(rows),
    bookingPace: computeBookingPace(rows, hasBookingStatus),
    coverage,
  };
}

function computeCoreMetrics(
  rows: readonly PricingDayRow[],
  bookedRows: readonly PricingDayRow[],
  hasBookingStatus: boolean,
) {
  const allPrices = rows.map((r) => r.price);
  const bookedPrices = bookedRows.map((r) => r.price);

  // ADR = diária média das noites efetivamente vendidas. Sem status de
  // reserva no CSV, essa distinção não existe e a métrica fica indisponível.
  const adrValue = hasBookingStatus ? mean(bookedPrices) : null;
  const adrSample = hasBookingStatus ? compact(bookedPrices).length : 0;

  const occupancyValue = hasBookingStatus
    ? safeDiv(bookedRows.length, rows.length)
    : mean(rows.map((r) => r.occupancy));
  const occupancySample = hasBookingStatus
    ? rows.length
    : compact(rows.map((r) => r.occupancy)).length;

  const revenueValue = hasBookingStatus ? sum(bookedPrices) : null;

  // RevPAR = receita / noites disponíveis. Calculado direto da receita quando
  // possível, para não compor dois arredondamentos.
  const revparValue = hasBookingStatus
    ? safeDiv(revenueValue, rows.length)
    : null;

  const explicitAdr = mean(rows.map((r) => r.adr));
  const explicitRevpar = mean(rows.map((r) => r.revpar));

  return {
    // Se o CSV já traz ADR/RevPAR calculados pelo PriceLabs, preferimos o
    // valor da fonte em vez do nosso — é o número que o usuário já conhece.
    adr:
      explicitAdr !== null
        ? metric(explicitAdr, compact(rows.map((r) => r.adr)).length, 'currency',
            'Valor informado no CSV.')
        : adrValue !== null
          ? metric(adrValue, adrSample, 'currency',
              'Média das diárias das noites reservadas.')
          : unavailable(
              'Requer coluna de status de reserva ou de ADR no CSV.',
            ),
    revpar:
      explicitRevpar !== null
        ? metric(explicitRevpar, compact(rows.map((r) => r.revpar)).length,
            'currency', 'Valor informado no CSV.')
        : revparValue !== null
          ? metric(revparValue, rows.length, 'currency',
              'Receita dividida pelo total de noites do período.')
          : unavailable(
              'Requer coluna de status de reserva ou de RevPAR no CSV.',
            ),
    occupancy:
      occupancyValue !== null
        ? metric(occupancyValue, occupancySample, 'ratio',
            hasBookingStatus
              ? 'Noites reservadas sobre noites do período.'
              : 'Média da coluna de ocupação do CSV.')
        : unavailable('Requer coluna de ocupação ou de status de reserva.'),
    revenue:
      revenueValue !== null
        ? metric(revenueValue, bookedRows.length, 'currency',
            'Soma das diárias das noites reservadas.')
        : unavailable('Requer status de reserva e preço por noite.'),
    averagePrice: metric(
      mean(allPrices),
      compact(allPrices).length,
      'currency',
      'Média do preço de todas as noites do período.',
    ),
    medianPrice: metric(
      median(allPrices),
      compact(allPrices).length,
      'currency',
    ),
    minPriceConfigured: metric(
      mean(rows.map((r) => r.minPrice)),
      compact(rows.map((r) => r.minPrice)).length,
      'currency',
      'Média do piso configurado no PriceLabs.',
    ),
    maxPriceConfigured: metric(
      mean(rows.map((r) => r.maxPrice)),
      compact(rows.map((r) => r.maxPrice)).length,
      'currency',
      'Média do teto configurado no PriceLabs.',
    ),
    observedMinPrice: metric(
      minOf(allPrices),
      compact(allPrices).length,
      'currency',
    ),
    observedMaxPrice: metric(
      maxOf(allPrices),
      compact(allPrices).length,
      'currency',
    ),
    averageLeadTimeDays: metric(
      mean(rows.map((r) => r.leadTimeDays)),
      compact(rows.map((r) => r.leadTimeDays)).length,
      'days',
    ),
    averageMinStay: metric(
      mean(rows.map((r) => r.minStay)),
      compact(rows.map((r) => r.minStay)).length,
      'nights',
    ),
    averageDiscountPct: metric(
      mean(rows.map((r) => r.discountPct)),
      compact(rows.map((r) => r.discountPct)).length,
      'percent',
    ),
    averageAdjustmentPct: metric(
      mean(rows.map((r) => r.adjustmentPct)),
      compact(rows.map((r) => r.adjustmentPct)).length,
      'percent',
    ),
  };
}

function computePriceVsRecommended(rows: readonly PricingDayRow[]) {
  const comparable = rows.filter(
    (r) => r.price !== null && r.recommendedPrice !== null && r.recommendedPrice !== 0,
  );

  if (comparable.length === 0) {
    const note = 'Requer as colunas de preço praticado e preço recomendado.';
    return {
      priceVsRecommendedPct: unavailable(note),
      daysBelowRecommended: unavailable(note),
      daysAboveRecommended: unavailable(note),
    };
  }

  const deltas = comparable.map(
    (r) => ((r.price! - r.recommendedPrice!) / r.recommendedPrice!) * 100,
  );

  return {
    priceVsRecommendedPct: metric(
      mean(deltas),
      comparable.length,
      'percent',
      'Positivo = praticando acima do recomendado.',
    ),
    daysBelowRecommended: metric(
      comparable.filter((r) => r.price! < r.recommendedPrice!).length,
      comparable.length,
      'days',
    ),
    daysAboveRecommended: metric(
      comparable.filter((r) => r.price! > r.recommendedPrice!).length,
      comparable.length,
      'days',
    ),
  };
}

function computeWeekendMetrics(rows: readonly PricingDayRow[]) {
  const weekendPrices = rows.filter((r) => r.isWeekend).map((r) => r.price);
  const weekdayPrices = rows.filter((r) => !r.isWeekend).map((r) => r.price);

  const weekendAvg = mean(weekendPrices);
  const weekdayAvg = mean(weekdayPrices);

  const premium =
    weekendAvg !== null && weekdayAvg !== null && weekdayAvg !== 0
      ? ((weekendAvg - weekdayAvg) / weekdayAvg) * 100
      : null;

  const configured = mean(rows.map((r) => r.weekendMarkupPct));

  return {
    weekendPremiumPct:
      premium !== null
        ? metric(
            premium,
            compact(weekendPrices).length + compact(weekdayPrices).length,
            'percent',
            'Preço médio de sexta e sábado vs. demais dias.',
          )
        : unavailable('Requer preços em dias de semana e de fim de semana.'),
    configuredWeekendMarkupPct:
      configured !== null
        ? metric(
            configured,
            compact(rows.map((r) => r.weekendMarkupPct)).length,
            'percent',
          )
        : unavailable('O CSV não traz a coluna de markup de fim de semana.'),
  };
}

function computePriceByWeekday(rows: readonly PricingDayRow[]): WeekdayPrice[] {
  return Array.from({ length: 7 }, (_unused, weekday) => {
    const dayRows = rows.filter((r) => r.weekday === weekday);

    return {
      weekday,
      label: WEEKDAY_LABELS[weekday]!,
      averagePrice: round(mean(dayRows.map((r) => r.price)), 2),
      averageOccupancy: round(mean(dayRows.map((r) => r.occupancy)), 4),
      days: dayRows.length,
    };
  });
}

function computeMonthly(
  rows: readonly PricingDayRow[],
  hasBookingStatus: boolean,
): MonthlyBreakdown[] {
  const byMonth = new Map<string, PricingDayRow[]>();

  for (const row of rows) {
    const month = monthOf(row.date);
    const bucket = byMonth.get(month);
    if (bucket) bucket.push(row);
    else byMonth.set(month, [row]);
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, monthRows]) => ({
      month,
      averagePrice: round(mean(monthRows.map((r) => r.price)), 2),
      averageOccupancy: hasBookingStatus
        ? round(safeDiv(monthRows.filter((r) => r.booked === true).length, monthRows.length), 4)
        : round(mean(monthRows.map((r) => r.occupancy)), 4),
      revenue: hasBookingStatus
        ? round(sum(monthRows.filter((r) => r.booked === true).map((r) => r.price)), 2)
        : null,
      days: monthRows.length,
    }));
}

/** Faixas de antecedência usadas no mercado de short-term rental. */
const LEAD_TIME_BUCKETS: ReadonlyArray<{
  label: string;
  minDays: number;
  maxDays: number | null;
}> = [
  { label: 'Última hora (0-3 dias)', minDays: 0, maxDays: 3 },
  { label: 'Curta (4-14 dias)', minDays: 4, maxDays: 14 },
  { label: 'Média (15-45 dias)', minDays: 15, maxDays: 45 },
  { label: 'Longa (46+ dias)', minDays: 46, maxDays: null },
];

function computeLeadTimeBuckets(
  rows: readonly PricingDayRow[],
): LeadTimeBucket[] {
  const withLeadTime = rows.filter((r) => r.leadTimeDays !== null);
  if (withLeadTime.length === 0) return [];

  return LEAD_TIME_BUCKETS.map((bucket) => {
    const bucketRows = withLeadTime.filter((r) => {
      const lead = r.leadTimeDays!;
      return (
        lead >= bucket.minDays &&
        (bucket.maxDays === null || lead <= bucket.maxDays)
      );
    });

    return {
      label: bucket.label,
      minDays: bucket.minDays,
      maxDays: bucket.maxDays,
      averagePrice: round(mean(bucketRows.map((r) => r.price)), 2),
      averageDiscountPct: round(mean(bucketRows.map((r) => r.discountPct)), 2),
      days: bucketRows.length,
    };
  });
}

/**
 * Encontra intervalos livres entre noites reservadas.
 *
 * Um "orphan gap" é um buraco menor que a estadia mínima exigida: ninguém
 * consegue reservá-lo sem que o anfitrião reduza o minimum stay daqueles dias.
 * Só faz sentido calcular com status de reserva no CSV.
 */
function computeGapMetrics(
  rows: readonly PricingDayRow[],
  hasBookingStatus: boolean,
): { gaps: CalendarGap[]; orphanGaps: CalendarGap[] } {
  if (!hasBookingStatus || rows.length === 0) {
    return { gaps: [], orphanGaps: [] };
  }

  const gaps: CalendarGap[] = [];

  let runStart: PricingDayRow | null = null;
  let runRows: PricingDayRow[] = [];
  let sawBookedBefore = false;

  const closeRun = (nextBooked: boolean) => {
    if (runStart === null) return;

    // Só é "gap" quando cercado por reservas dos dois lados; um vazio no
    // início ou no fim do período é apenas calendário em aberto.
    if (sawBookedBefore && nextBooked) {
      const minStays = compact(runRows.map((r) => r.minStay));
      const minStayRequired = minStays.length > 0 ? Math.max(...minStays) : null;
      const nights = runRows.length;

      gaps.push({
        startDate: runStart.date,
        endDate: runRows[runRows.length - 1]!.date,
        nights,
        minStayRequired,
        isOrphan: minStayRequired !== null && nights < minStayRequired,
      });
    }

    runStart = null;
    runRows = [];
  };

  for (const row of rows) {
    if (row.booked === true) {
      closeRun(true);
      sawBookedBefore = true;
      continue;
    }

    if (runStart === null) {
      runStart = row;
      runRows = [row];
    } else {
      // Descontinuidade no calendário encerra o intervalo corrente.
      const previous = runRows[runRows.length - 1]!;
      if (daysBetween(previous.date, row.date) === 1) {
        runRows.push(row);
      } else {
        closeRun(false);
        runStart = row;
        runRows = [row];
      }
    }
  }

  closeRun(false);

  return { gaps, orphanGaps: gaps.filter((g) => g.isOrphan) };
}

function computeEventImpacts(rows: readonly PricingDayRow[]): EventImpact[] {
  const eventRows = rows.filter((r) => r.events.length > 0);
  if (eventRows.length === 0) return [];

  // Mediana mensal como linha de base: resiste a outliers melhor que a média.
  const baselineByMonth = new Map<string, number | null>();

  for (const row of rows) {
    const month = monthOf(row.date);
    if (baselineByMonth.has(month)) continue;

    const monthPrices = rows
      .filter((r) => monthOf(r.date) === month && r.events.length === 0)
      .map((r) => r.price);

    baselineByMonth.set(month, median(monthPrices));
  }

  return eventRows.map((row) => {
    const baseline = baselineByMonth.get(monthOf(row.date)) ?? null;

    const premium =
      row.price !== null && baseline !== null && baseline !== 0
        ? ((row.price - baseline) / baseline) * 100
        : null;

    return {
      date: row.date,
      events: row.events,
      price: row.price,
      recommendedPrice: row.recommendedPrice,
      premiumVsBaselinePct: round(premium, 2),
    };
  });
}

/**
 * Pace = ritmo de preenchimento do calendário.
 *
 * Sem histórico de quando cada reserva entrou, o CSV não permite calcular pace
 * de verdade. O que dá para medir é a ocupação dos próximos 30 dias — um proxy
 * declarado como tal, não um número apresentado como pace real.
 */
function computeBookingPace(
  rows: readonly PricingDayRow[],
  hasBookingStatus: boolean,
): Metric {
  if (!hasBookingStatus || rows.length === 0) {
    return unavailable(
      'Requer histórico de datas de reserva, que o export de calendário não traz.',
    );
  }

  const next30 = rows.slice(0, 30);
  const booked = next30.filter((r) => r.booked === true).length;

  return metric(
    safeDiv(booked, next30.length),
    next30.length,
    'ratio',
    'Proxy: ocupação dos primeiros 30 dias do período. Não é pace histórico.',
  );
}

function computeCoverage(rows: readonly PricingDayRow[]): PricingDataCoverage {
  const count = (predicate: (r: PricingDayRow) => boolean) =>
    rows.filter(predicate).length;

  return {
    totalDays: rows.length,
    withPrice: count((r) => r.price !== null),
    withRecommendedPrice: count((r) => r.recommendedPrice !== null),
    withOccupancy: count((r) => r.occupancy !== null),
    withBookingStatus: count((r) => r.booked !== null),
    withMinMax: count((r) => r.minPrice !== null && r.maxPrice !== null),
    withLeadTime: count((r) => r.leadTimeDays !== null),
    withMinStay: count((r) => r.minStay !== null),
    withEvents: count((r) => r.events.length > 0),
    withDiscount: count((r) => r.discountPct !== null),
  };
}
