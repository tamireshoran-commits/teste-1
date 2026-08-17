import { describe, expect, it } from 'vitest';
import {
  buildScore,
  type ScoreComponentInput,
} from '@/server/core/analysis/scoring/buildScore';
import {
  assertPositiveWeights,
  DEFAULT_SCORING_CONFIG,
} from '@/server/core/analysis/scoring/config';

const component = (
  overrides: Partial<ScoreComponentInput> = {},
): ScoreComponentInput => ({
  key: 'x',
  label: 'X',
  weight: 50,
  score: 80,
  available: true,
  reason: 'motivo',
  ...overrides,
});

describe('buildScore', () => {
  it('calcula a média ponderada dos componentes disponíveis', () => {
    const result = buildScore(
      [
        component({ key: 'a', weight: 50, score: 100 }),
        component({ key: 'b', weight: 50, score: 0 }),
      ],
      'v1',
    );

    expect(result.score).toBe(50);
    expect(result.coverage).toBe(1);
  });

  it('respeita pesos desiguais', () => {
    const result = buildScore(
      [
        component({ key: 'a', weight: 75, score: 100 }),
        component({ key: 'b', weight: 25, score: 0 }),
      ],
      'v1',
    );

    expect(result.score).toBe(75);
  });

  it('redistribui o peso de componentes indisponíveis', () => {
    const result = buildScore(
      [
        component({ key: 'a', weight: 50, score: 80 }),
        component({ key: 'b', weight: 50, score: null, available: false }),
      ],
      'v1',
    );

    // O componente ausente não entra como zero: o score é o do disponível.
    expect(result.score).toBe(80);
    expect(result.coverage).toBe(0.5);
  });

  it('zera o score apenas quando nenhum componente está disponível', () => {
    const result = buildScore(
      [component({ score: null, available: false })],
      'v1',
    );

    expect(result.score).toBe(0);
    expect(result.coverage).toBe(0);
  });

  it('os pesos efetivos somam 100 quando há algum disponível', () => {
    const result = buildScore(
      [
        component({ key: 'a', weight: 30 }),
        component({ key: 'b', weight: 20 }),
        component({ key: 'c', weight: 50, score: null, available: false }),
      ],
      'v1',
    );

    const total = result.components.reduce((acc, c) => acc + c.effectiveWeight, 0);
    expect(total).toBeCloseTo(100);
  });

  it('limita o score ao intervalo 0-100', () => {
    const acima = buildScore([component({ score: 150 })], 'v1');
    const abaixo = buildScore([component({ score: -20 })], 'v1');

    expect(acima.score).toBe(100);
    expect(abaixo.score).toBe(0);
  });

  it('trata score null como indisponível mesmo com available true', () => {
    const result = buildScore(
      [
        component({ key: 'a', weight: 50, score: null, available: true }),
        component({ key: 'b', weight: 50, score: 60 }),
      ],
      'v1',
    );

    expect(result.components[0]!.available).toBe(false);
    expect(result.score).toBe(60);
  });

  it('propaga a versão da configuração', () => {
    expect(buildScore([component()], 'v42').configVersion).toBe('v42');
  });
});

describe('DEFAULT_SCORING_CONFIG', () => {
  it('todos os grupos de pesos somam mais que zero', () => {
    const { weights } = DEFAULT_SCORING_CONFIG;

    for (const [group, values] of Object.entries(weights)) {
      expect(() => assertPositiveWeights(values, group)).not.toThrow();
    }
  });

  it('os pesos do score geral somam 100', () => {
    const total = Object.values(DEFAULT_SCORING_CONFIG.weights.overall).reduce(
      (a, b) => a + b,
      0,
    );

    expect(total).toBe(100);
  });

  it('os pesos do pricing somam 100', () => {
    const total = Object.values(DEFAULT_SCORING_CONFIG.weights.pricing).reduce(
      (a, b) => a + b,
      0,
    );

    expect(total).toBe(100);
  });

  it('as faixas de threshold são coerentes', () => {
    const { occupancy, weekendPremium } = DEFAULT_SCORING_CONFIG.pricingThresholds;

    for (const band of [occupancy, weekendPremium]) {
      expect(band.hardMin).toBeLessThan(band.idealMin);
      expect(band.idealMin).toBeLessThan(band.idealMax);
      expect(band.idealMax).toBeLessThanOrEqual(band.hardMax);
    }
  });
});
