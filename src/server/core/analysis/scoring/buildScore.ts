import { toScore } from '@/server/core/shared/math';
import type { ScoreComponent, ScoreResult } from '@/server/core/types';

/** Componente antes da redistribuição de pesos. */
export interface ScoreComponentInput {
  key: string;
  label: string;
  weight: number;
  /** 0..100, ou null quando não há dado para avaliar. */
  score: number | null;
  available: boolean;
  reason: string;
}

/**
 * Consolida componentes em um score final.
 *
 * Decisão central: componentes sem dado **não entram como zero**. O peso deles
 * é redistribuído proporcionalmente entre os disponíveis, e `coverage` reporta
 * quanto do total pôde ser avaliado. Um usuário cujo CSV não traz ocupação não
 * deve ser punido por isso — deve ser informado de que aquela dimensão ficou
 * de fora.
 */
export function buildScore(
  components: readonly ScoreComponentInput[],
  configVersion: string,
): ScoreResult {
  const totalWeight = components.reduce((acc, c) => acc + c.weight, 0);

  const availableWeight = components
    .filter((c) => c.available && c.score !== null)
    .reduce((acc, c) => acc + c.weight, 0);

  const coverage = totalWeight > 0 ? availableWeight / totalWeight : 0;

  const resolved: ScoreComponent[] = components.map((c) => {
    const usable = c.available && c.score !== null;

    return {
      key: c.key,
      label: c.label,
      score: usable ? toScore(c.score!) : null,
      weight: c.weight,
      // Redistribui o peso dos indisponíveis entre os que sobraram.
      effectiveWeight:
        usable && availableWeight > 0 ? (c.weight / availableWeight) * 100 : 0,
      available: usable,
      reason: c.reason,
    };
  });

  const weighted = resolved.reduce(
    (acc, c) => (c.score === null ? acc : acc + c.score * c.effectiveWeight),
    0,
  );

  return {
    score: availableWeight > 0 ? toScore(weighted / 100) : 0,
    components: resolved,
    coverage,
    configVersion,
  };
}
