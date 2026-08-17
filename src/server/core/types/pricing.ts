import type {
  Finding,
  Opportunity,
  PricingSourceName,
  ScoreResult,
  Warning,
} from './common';

/**
 * Uma linha = um dia do calendário.
 *
 * Todo campo é anulável de propósito: exports do PriceLabs variam bastante
 * entre contas e versões. `null` significa "o CSV não trouxe esse dado" e
 * nunca é substituído por estimativa.
 */
export interface PricingDayRow {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  price: number | null;
  recommendedPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  /** 0..1. */
  occupancy: number | null;
  booked: boolean | null;
  bookings: number | null;
  adr: number | null;
  revpar: number | null;
  leadTimeDays: number | null;
  minStay: number | null;
  season: string | null;
  events: string[];
  adjustmentPct: number | null;
  weekendMarkupPct: number | null;
  discountPct: number | null;
  /** 0 = domingo. Derivado da data. */
  weekday: number;
  /** Derivado: sexta e sábado por padrão (ver WEEKEND_DAYS). */
  isWeekend: boolean;
  /** Linha original do CSV, para auditoria. */
  raw: Record<string, string>;
}

export interface PricingDataset {
  source: PricingSourceName;
  fileName?: string;
  currency: string | null;
  rows: PricingDayRow[];
  dateFrom: string | null;
  dateTo: string | null;
  rowCount: number;
  skippedCount: number;
  /** header original -> campo canônico, para auditar o parse. */
  columnMapping: Record<string, string>;
  warnings: Warning[];
}

/** Métrica que pode não ter dado suficiente para ser calculada. */
export interface Metric<T = number> {
  value: T | null;
  available: boolean;
  /** Quantos dias entraram no cálculo. */
  sampleSize: number;
  unit?: string;
  note?: string;
}

export interface WeekdayPrice {
  weekday: number;
  label: string;
  averagePrice: number | null;
  averageOccupancy: number | null;
  days: number;
}

export interface MonthlyBreakdown {
  /** `YYYY-MM`. */
  month: string;
  averagePrice: number | null;
  averageOccupancy: number | null;
  revenue: number | null;
  days: number;
}

export interface LeadTimeBucket {
  label: string;
  minDays: number;
  maxDays: number | null;
  averagePrice: number | null;
  averageDiscountPct: number | null;
  days: number;
}

/**
 * Um intervalo livre entre dois dias reservados.
 * `isOrphan` = o buraco é menor que a estadia mínima exigida, portanto
 * inviável de vender sem ajustar o minimum stay.
 */
export interface CalendarGap {
  startDate: string;
  endDate: string;
  nights: number;
  minStayRequired: number | null;
  isOrphan: boolean;
}

export interface EventImpact {
  date: string;
  events: string[];
  price: number | null;
  recommendedPrice: number | null;
  /** Preço do dia comparado à mediana do mês, em %. */
  premiumVsBaselinePct: number | null;
}

export interface PricingMetrics {
  adr: Metric;
  revpar: Metric;
  occupancy: Metric;
  revenue: Metric;
  averagePrice: Metric;
  medianPrice: Metric;
  minPriceConfigured: Metric;
  maxPriceConfigured: Metric;
  observedMinPrice: Metric;
  observedMaxPrice: Metric;
  averageLeadTimeDays: Metric;
  averageMinStay: Metric;

  /** Diferença média entre preço praticado e recomendado, em %. */
  priceVsRecommendedPct: Metric;
  daysBelowRecommended: Metric;
  daysAboveRecommended: Metric;

  /** Prêmio de fim de semana observado, em %. */
  weekendPremiumPct: Metric;
  /** Markup de fim de semana configurado no PriceLabs, em %. */
  configuredWeekendMarkupPct: Metric;
  averageDiscountPct: Metric;
  averageAdjustmentPct: Metric;

  priceByWeekday: WeekdayPrice[];
  monthly: MonthlyBreakdown[];
  leadTimeBuckets: LeadTimeBucket[];
  gaps: CalendarGap[];
  orphanGaps: CalendarGap[];
  events: EventImpact[];

  /** Ritmo de reservas. Só disponível quando o CSV traz status de reserva. */
  bookingPace: Metric;

  coverage: PricingDataCoverage;
}

/** Quais campos o CSV realmente trouxe — base do componente "completude". */
export interface PricingDataCoverage {
  totalDays: number;
  withPrice: number;
  withRecommendedPrice: number;
  withOccupancy: number;
  withBookingStatus: number;
  withMinMax: number;
  withLeadTime: number;
  withMinStay: number;
  withEvents: number;
  withDiscount: number;
}

export interface PricingAnalysisResult {
  metrics: PricingMetrics;
  score: ScoreResult;
  problems: Finding[];
  opportunities: Opportunity[];
  /** Resumo textual do porquê do score, em linguagem de hipótese. */
  summary: string;
}
