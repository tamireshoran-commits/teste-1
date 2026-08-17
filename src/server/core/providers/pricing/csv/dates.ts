import { isEmptyValue } from './coerce';

/**
 * Interpretação de datas de CSV.
 *
 * O problema real: `03/04/2026` é 3 de abril (pt-BR) ou 4 de março (en-US)?
 * Adivinhar linha a linha produziria um calendário inconsistente. A estratégia
 * é decidir a ordem **uma vez para o arquivo inteiro**, procurando alguma data
 * em que um dos campos passe de 12 — isso desempata sem ambiguidade.
 */

export type DateOrder = 'ISO' | 'DMY' | 'MDY';

const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})/;
const SLASH_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/;
const SHORT_YEAR_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/;

/**
 * Determina a ordem dia/mês varrendo a coluna inteira.
 * Sem evidência decisiva, assume DMY (público-alvo brasileiro).
 */
export function detectDateOrder(samples: readonly string[]): DateOrder {
  let sawIso = false;

  for (const sample of samples) {
    if (isEmptyValue(sample)) continue;

    const text = sample.trim();

    if (ISO_RE.test(text)) {
      sawIso = true;
      continue;
    }

    const match = SLASH_RE.exec(text) ?? SHORT_YEAR_RE.exec(text);
    if (!match) continue;

    const first = Number(match[1]);
    const second = Number(match[2]);

    // Primeiro campo > 12 só pode ser dia.
    if (first > 12) return 'DMY';
    // Segundo campo > 12 só pode ser dia => primeiro é mês.
    if (second > 12) return 'MDY';
  }

  return sawIso ? 'ISO' : 'DMY';
}

/**
 * Converte para `YYYY-MM-DD`, ou `null` se não for uma data válida.
 * Valida o dia contra o mês (31/02 é rejeitado, não normalizado para 03/03).
 */
export function parseDate(
  raw: string | undefined,
  order: DateOrder,
): string | null {
  if (isEmptyValue(raw)) return null;

  const text = raw!.trim();

  const isoMatch = ISO_RE.exec(text);
  if (isoMatch) {
    return buildDate(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
    );
  }

  const slashMatch = SLASH_RE.exec(text);
  if (slashMatch) {
    const a = Number(slashMatch[1]);
    const b = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);

    return order === 'MDY'
      ? buildDate(year, a, b)
      : buildDate(year, b, a);
  }

  const shortMatch = SHORT_YEAR_RE.exec(text);
  if (shortMatch) {
    const a = Number(shortMatch[1]);
    const b = Number(shortMatch[2]);
    // Janela de 2 dígitos: 00-69 => 2000s, 70-99 => 1900s.
    const rawYear = Number(shortMatch[3]);
    const year = rawYear < 70 ? 2000 + rawYear : 1900 + rawYear;

    return order === 'MDY' ? buildDate(year, a, b) : buildDate(year, b, a);
  }

  return null;
}

function buildDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1) return null;

  if (day > daysInMonth(year, month)) return null;

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');

  return `${year}-${mm}-${dd}`;
}

function daysInMonth(year: number, month: number): number {
  // Dia 0 do mês seguinte = último dia deste mês.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Dia da semana em UTC (0 = domingo), a partir de `YYYY-MM-DD`. */
export function weekdayOf(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

/**
 * Sexta (5) e sábado (6) — as noites cobradas como fim de semana no aluguel
 * por temporada. Domingo é noite de saída na maioria dos casos.
 */
export const WEEKEND_DAYS: readonly number[] = [5, 6];

export function isWeekendDay(weekday: number): boolean {
  return WEEKEND_DAYS.includes(weekday);
}

export const WEEKDAY_LABELS: readonly string[] = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
];

/** Diferença em dias entre duas datas ISO (b - a). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };

  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** Soma dias a uma data ISO, devolvendo ISO. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days));

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/** `YYYY-MM` a partir de `YYYY-MM-DD`. */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}
