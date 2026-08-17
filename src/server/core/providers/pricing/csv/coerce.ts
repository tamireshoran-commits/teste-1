/**
 * Conversão tolerante de valores de CSV.
 *
 * Exports reais chegam com moeda ("R$ 1.234,56"), percentual ("12,5%"),
 * separador decimal variando por localidade e marcadores de vazio ("-", "N/A").
 * Todo conversor devolve `null` quando não consegue interpretar — nunca zero,
 * porque zero é um valor legítimo e distorceria médias.
 */

const EMPTY_MARKERS = new Set([
  '',
  '-',
  '--',
  'n/a',
  'na',
  'null',
  'none',
  'nan',
  '#n/a',
  'undefined',
]);

export function isEmptyValue(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  return EMPTY_MARKERS.has(raw.trim().toLowerCase());
}

/**
 * Interpreta um número respeitando as duas convenções decimais.
 *
 * A ambiguidade real é "1.234" (mil e duzentos e trinta e quatro, ou 1,234?).
 * Regra: se houver ambos os separadores, o **último** é o decimal. Se houver
 * apenas um e ele separar exatamente 3 dígitos finais, é separador de milhar.
 */
export function toNumber(raw: string | undefined): number | null {
  if (isEmptyValue(raw)) return null;

  let text = raw!.trim();

  // Negativo entre parênteses, comum em exports contábeis: (12,50)
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }

  // Remove símbolos de moeda, espaços (inclusive não separável) e %.
  text = text.replace(/[R$€£¥\s %]/gi, '');

  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }

  if (text === '' || !/^[\d.,]+$/.test(text)) return null;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');

  let normalized: string;

  if (lastComma >= 0 && lastDot >= 0) {
    // Ambos presentes: o mais à direita é o decimal.
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandSep = decimalSep === ',' ? '.' : ',';
    normalized = text
      .split(thousandSep)
      .join('')
      .replace(decimalSep, '.');
  } else if (lastComma >= 0) {
    normalized = isThousandSeparator(text, ',')
      ? text.split(',').join('')
      : text.replace(',', '.');
  } else if (lastDot >= 0) {
    normalized = isThousandSeparator(text, '.') ? text.split('.').join('') : text;
  } else {
    normalized = text;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;

  return negative ? -value : value;
}

/**
 * Um separador é de milhar quando divide o número em grupos de exatamente
 * 3 dígitos (1.234, 1.234.567) — e não quando sobra outro tamanho (1.23).
 */
function isThousandSeparator(text: string, separator: string): boolean {
  const parts = text.split(separator);
  if (parts.length < 2) return false;

  const [head, ...rest] = parts;
  if (head === undefined || head.length === 0 || head.length > 3) return false;

  return rest.every((part) => part.length === 3);
}

/**
 * Converte um percentual para fração 0..1.
 *
 * Aceita "85%", "85", "0.85". A heurística: valor > 1 é tratado como
 * percentual; <= 1 já é fração. `allowAboveOne` desliga isso para campos como
 * markup, onde 150% é legítimo.
 */
export function toRatio(raw: string | undefined): number | null {
  if (isEmptyValue(raw)) return null;

  const hasPercentSign = raw!.includes('%');
  const value = toNumber(raw);
  if (value === null) return null;

  if (hasPercentSign) return value / 100;

  // Sem símbolo: acima de 1 quase certamente é percentual (85 = 85%).
  return value > 1 ? value / 100 : value;
}

/** Percentual mantido na escala de porcentagem (12,5% -> 12.5). */
export function toPercent(raw: string | undefined): number | null {
  if (isEmptyValue(raw)) return null;

  const hasPercentSign = raw!.includes('%');
  const value = toNumber(raw);
  if (value === null) return null;

  // Sem símbolo e dentro de 0..1, assume fração e converte para percentual.
  if (!hasPercentSign && Math.abs(value) <= 1 && value !== 0) return value * 100;

  return value;
}

export function toInteger(raw: string | undefined): number | null {
  const value = toNumber(raw);
  if (value === null) return null;
  return Math.round(value);
}

const TRUE_VALUES = new Set([
  'true', '1', 'yes', 'y', 'sim', 's', 'booked', 'reservado', 'ocupado',
  'blocked', 'unavailable', 'indisponivel', 'indisponível',
]);

const FALSE_VALUES = new Set([
  'false', '0', 'no', 'n', 'nao', 'não', 'available', 'disponivel',
  'disponível', 'vago', 'open', 'livre',
]);

export function toBoolean(raw: string | undefined): boolean | null {
  if (isEmptyValue(raw)) return null;

  const text = raw!.trim().toLowerCase();
  if (TRUE_VALUES.has(text)) return true;
  if (FALSE_VALUES.has(text)) return false;

  return null;
}

export function toText(raw: string | undefined): string | null {
  if (isEmptyValue(raw)) return null;
  return raw!.trim();
}

/** Divide um campo de lista ("Natal; Réveillon" ou "a|b") em itens. */
export function toList(raw: string | undefined): string[] {
  const text = toText(raw);
  if (text === null) return [];

  return text
    .split(/[;|,]/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}
