/**
 * Helpers numéricos usados pela análise de pricing e pelo scoring.
 *
 * Todos ignoram `null`/`undefined`/`NaN` e devolvem `null` quando não há dado
 * suficiente — o domínio nunca substitui dado ausente por zero, porque isso
 * distorceria médias e scores.
 */

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Remove null/undefined/NaN de uma lista de valores potencialmente ausentes. */
export function compact(values: readonly (number | null | undefined)[]): number[] {
  return values.filter(isFiniteNumber);
}

export function mean(values: readonly (number | null | undefined)[]): number | null {
  const nums = compact(values);
  if (nums.length === 0) return null;
  return nums.reduce((acc, n) => acc + n, 0) / nums.length;
}

export function sum(values: readonly (number | null | undefined)[]): number | null {
  const nums = compact(values);
  if (nums.length === 0) return null;
  return nums.reduce((acc, n) => acc + n, 0);
}

export function median(values: readonly (number | null | undefined)[]): number | null {
  const nums = compact(values).sort((a, b) => a - b);
  if (nums.length === 0) return null;

  const mid = Math.floor(nums.length / 2);

  if (nums.length % 2 === 1) return nums[mid]!;
  return (nums[mid - 1]! + nums[mid]!) / 2;
}

export function minOf(values: readonly (number | null | undefined)[]): number | null {
  const nums = compact(values);
  return nums.length ? Math.min(...nums) : null;
}

export function maxOf(values: readonly (number | null | undefined)[]): number | null {
  const nums = compact(values);
  return nums.length ? Math.max(...nums) : null;
}

/** Divisão que devolve null em vez de Infinity/NaN. */
export function safeDiv(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  if (!isFiniteNumber(numerator) || !isFiniteNumber(denominator)) return null;
  if (denominator === 0) return null;
  return numerator / denominator;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Arredonda para `decimals` casas, preservando null. */
export function round(
  value: number | null | undefined,
  decimals = 2,
): number | null {
  if (!isFiniteNumber(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Score sempre inteiro dentro de 0..100. */
export function toScore(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

/**
 * Interpola linearmente um valor dentro de uma faixa para 0..1.
 * Fora da faixa satura em 0 ou 1.
 */
export function normalize(value: number, from: number, to: number): number {
  if (from === to) return 0;
  return clamp((value - from) / (to - from), 0, 1);
}

/**
 * Pontuação em "faixa ideal": 1 no platô [idealMin, idealMax], caindo
 * linearmente até 0 nas bordas [hardMin, hardMax].
 *
 * Usado por métricas onde tanto o excesso quanto a falta são ruins — por
 * exemplo ocupação: 30% é fraco, mas 100% sugere preço abaixo do mercado.
 */
export function bandScore(
  value: number,
  { hardMin, idealMin, idealMax, hardMax }: {
    hardMin: number;
    idealMin: number;
    idealMax: number;
    hardMax: number;
  },
): number {
  if (value >= idealMin && value <= idealMax) return 1;
  if (value <= hardMin || value >= hardMax) return 0;

  if (value < idealMin) return normalize(value, hardMin, idealMin);
  return 1 - normalize(value, idealMax, hardMax);
}

/** Média de valores agrupados por chave. */
export function meanBy<T>(
  items: readonly T[],
  keyFn: (item: T) => string | number,
  valueFn: (item: T) => number | null | undefined,
): Map<string | number, number> {
  const buckets = new Map<string | number, number[]>();

  for (const item of items) {
    const value = valueFn(item);
    if (!isFiniteNumber(value)) continue;

    const key = keyFn(item);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(value);
    else buckets.set(key, [value]);
  }

  const result = new Map<string | number, number>();
  for (const [key, values] of buckets) {
    result.set(key, values.reduce((a, b) => a + b, 0) / values.length);
  }

  return result;
}
