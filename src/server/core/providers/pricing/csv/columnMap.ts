/**
 * Mapeamento de colunas do CSV para os campos canônicos do domínio.
 *
 * Não existe um schema único de export do PriceLabs: o conjunto de colunas
 * muda conforme o relatório escolhido, o idioma da conta e a versão. Por isso
 * o parser trabalha por **aliases normalizados** em vez de posição fixa —
 * mudar a ordem das colunas ou o idioma não quebra o import.
 */

export type CanonicalField =
  | 'date'
  | 'price'
  | 'recommendedPrice'
  | 'minPrice'
  | 'maxPrice'
  | 'occupancy'
  | 'booked'
  | 'bookings'
  | 'adr'
  | 'revpar'
  | 'leadTimeDays'
  | 'minStay'
  | 'season'
  | 'events'
  | 'adjustmentPct'
  | 'weekendMarkupPct'
  | 'discountPct'
  | 'currency';

/**
 * Normaliza um header para comparação: minúsculas, sem acento, sem pontuação.
 * "Preço Recomendado (R$)" -> "preco_recomendado_r"
 */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Aliases por campo. A ordem importa: o primeiro alias que casar vence, então
 * variantes mais específicas vêm antes das genéricas.
 */
const FIELD_ALIASES: Record<CanonicalField, string[]> = {
  date: ['date', 'data', 'dia', 'day', 'calendar_date', 'stay_date', 'fecha'],

  recommendedPrice: [
    'recommended_price',
    'recommended',
    'suggested_price',
    'pricelabs_price',
    'pl_price',
    'preco_recomendado',
    'preco_sugerido',
    'valor_recomendado',
  ],
  minPrice: [
    'min_price',
    'minimum_price',
    'base_min_price',
    'floor_price',
    'preco_minimo',
    'valor_minimo',
  ],
  maxPrice: [
    'max_price',
    'maximum_price',
    'base_max_price',
    'ceiling_price',
    'preco_maximo',
    'valor_maximo',
  ],
  // Genérico por último para não capturar "recommended_price" antes da hora.
  price: [
    'final_price',
    'current_price',
    'listed_price',
    'nightly_price',
    'rate',
    'preco_atual',
    'preco_final',
    'diaria',
    'price',
    'preco',
    'valor',
  ],

  occupancy: [
    'occupancy',
    'occupancy_rate',
    'occ',
    'market_occupancy',
    'ocupacao',
    'taxa_de_ocupacao',
  ],
  booked: [
    'booked',
    'is_booked',
    'reserved',
    'booking_status',
    'status',
    'availability',
    'reservado',
    'ocupado',
    'disponibilidade',
  ],
  bookings: ['bookings', 'reservations', 'num_bookings', 'reservas'],

  adr: ['adr', 'average_daily_rate', 'diaria_media'],
  revpar: ['revpar', 'rev_par', 'revenue_per_available_room'],

  leadTimeDays: [
    'lead_time',
    'lead_time_days',
    'booking_window',
    'days_in_advance',
    'antecedencia',
    'antecedencia_dias',
    'janela_de_reserva',
  ],
  minStay: [
    'min_stay',
    'minimum_stay',
    'minimum_nights',
    'min_nights',
    'los',
    'estadia_minima',
    'noites_minimas',
  ],

  season: ['season', 'seasonality', 'seasonality_tag', 'sazonalidade', 'temporada'],
  events: ['events', 'event', 'holidays', 'holiday', 'eventos', 'feriados'],

  adjustmentPct: [
    'adjustment',
    'adjustments',
    'price_adjustment',
    'occupancy_adjustment',
    'demand_adjustment',
    'ajuste',
    'ajustes',
    'ajuste_de_ocupacao',
  ],
  weekendMarkupPct: [
    'weekend_markup',
    'weekend_adjustment',
    'markup',
    'markup_fim_de_semana',
    'acrescimo_fim_de_semana',
  ],
  discountPct: [
    'discount',
    'discounts',
    'last_minute_discount',
    'lm_discount',
    'desconto',
    'descontos',
    'desconto_ultima_hora',
  ],

  currency: ['currency', 'moeda', 'currency_code'],
};

export interface ColumnMapping {
  /** campo canônico -> índice da coluna no CSV. */
  indexByField: Partial<Record<CanonicalField, number>>;
  /** header original -> campo canônico, para auditoria e exibição. */
  headerToField: Record<string, string>;
  /** Headers que não casaram com nenhum campo conhecido. */
  unmappedHeaders: string[];
}

/**
 * Casa os headers do arquivo com os campos canônicos.
 *
 * Duas passadas: primeiro exigindo igualdade exata do header normalizado,
 * depois aceitando que o header *contenha* o alias. Isso evita que
 * "preco_recomendado_r" seja capturado por `price` antes de `recommendedPrice`
 * ter a chance de casar exatamente.
 */
export function buildColumnMapping(headers: readonly string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const indexByField: Partial<Record<CanonicalField, number>> = {};
  const headerToField: Record<string, string> = {};
  const takenIndexes = new Set<number>();

  const fields = Object.keys(FIELD_ALIASES) as CanonicalField[];

  const assign = (field: CanonicalField, index: number) => {
    indexByField[field] = index;
    takenIndexes.add(index);
    headerToField[headers[index] ?? normalized[index]!] = field;
  };

  // Passada 1: igualdade exata.
  for (const field of fields) {
    if (indexByField[field] !== undefined) continue;

    for (const alias of FIELD_ALIASES[field]) {
      const index = normalized.findIndex(
        (h, i) => h === alias && !takenIndexes.has(i),
      );

      if (index >= 0) {
        assign(field, index);
        break;
      }
    }
  }

  // Passada 2: header contém o alias como palavra.
  for (const field of fields) {
    if (indexByField[field] !== undefined) continue;

    for (const alias of FIELD_ALIASES[field]) {
      const index = normalized.findIndex(
        (h, i) => !takenIndexes.has(i) && containsToken(h, alias),
      );

      if (index >= 0) {
        assign(field, index);
        break;
      }
    }
  }

  const unmappedHeaders = headers.filter((_h, i) => !takenIndexes.has(i));

  return { indexByField, headerToField, unmappedHeaders };
}

/**
 * Verifica se `alias` aparece em `header` respeitando fronteiras de token,
 * para "adr" não casar dentro de "quadra".
 */
function containsToken(header: string, alias: string): boolean {
  if (header === alias) return true;

  const aliasTokens = alias.split('_');
  const headerTokens = header.split('_');

  for (let i = 0; i <= headerTokens.length - aliasTokens.length; i++) {
    const slice = headerTokens.slice(i, i + aliasTokens.length);
    if (slice.join('_') === alias) return true;
  }

  return false;
}

/** Campos sem os quais a análise não faz sentido. */
export const REQUIRED_FIELDS: readonly CanonicalField[] = ['date'];
