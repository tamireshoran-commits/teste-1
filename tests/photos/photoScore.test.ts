import { describe, expect, it } from 'vitest';
import { buildPhotoSetInsights } from '@/server/core/analysis/photos/insights';
import { computePhotoScore } from '@/server/core/analysis/photos/photoScore';
import type { PhotoAnalysisResult } from '@/server/core/types';

function photo(
  id: string,
  score: number,
  roomType = 'sala',
  overrides: Partial<PhotoAnalysisResult> = {},
): PhotoAnalysisResult {
  return {
    photoId: id,
    roomType,
    visualQuality: score,
    lighting: score,
    composition: score,
    professionalism: score,
    valuePerception: score,
    clarity: score,
    strengths: [],
    problems: [],
    recommendations: [],
    score,
    provider: 'stub',
    model: 'mock-model',
    fromCache: false,
    ...overrides,
  };
}

describe('buildPhotoSetInsights', () => {
  it('identifica melhor e pior foto', () => {
    const insights = buildPhotoSetInsights([
      photo('a', 60),
      photo('b', 90),
      photo('c', 40),
    ]);

    expect(insights.bestPhotoId).toBe('b');
    expect(insights.worstPhotoId).toBe('c');
  });

  it('não aponta pior foto quando só existe uma', () => {
    const insights = buildPhotoSetInsights([photo('a', 60)]);

    expect(insights.bestPhotoId).toBe('a');
    expect(insights.worstPhotoId).toBeNull();
  });

  it('sugere trocar a capa quando há foto claramente melhor', () => {
    // Capa 55, melhor 90 => margem de 35, bem acima do limiar.
    const insights = buildPhotoSetInsights([
      photo('capa', 55),
      photo('otima', 90),
    ]);

    expect(insights.suggestedCoverPhotoId).toBe('otima');
  });

  it('não sugere trocar a capa por diferença irrelevante', () => {
    // Trocar por 3 pontos seria ruído, não recomendação.
    const insights = buildPhotoSetInsights([photo('capa', 85), photo('b', 88)]);

    expect(insights.suggestedCoverPhotoId).toBeNull();
  });

  it('não sugere troca quando a capa já é a melhor', () => {
    const insights = buildPhotoSetInsights([photo('capa', 92), photo('b', 60)]);

    expect(insights.suggestedCoverPhotoId).toBeNull();
  });

  it('lista ambientes cobertos e os que faltam', () => {
    const insights = buildPhotoSetInsights([
      photo('a', 80, 'sala'),
      photo('b', 80, 'quarto'),
    ]);

    expect(insights.coveredRooms.sort()).toEqual(['quarto', 'sala']);
    expect(insights.missingRooms.sort()).toEqual(['banheiro', 'cozinha']);
  });

  it('marca ambiente coberto apenas por fotos fracas', () => {
    const insights = buildPhotoSetInsights([
      photo('a', 85, 'sala'),
      photo('b', 35, 'cozinha'),
      photo('c', 42, 'cozinha'),
    ]);

    expect(insights.weaklyCoveredRooms).toContain('cozinha');
    expect(insights.weaklyCoveredRooms).not.toContain('sala');
  });

  it('detecta fotos redundantes do mesmo ambiente com notas próximas', () => {
    const insights = buildPhotoSetInsights([
      photo('a', 80, 'quarto'),
      photo('b', 79, 'quarto'),
      photo('c', 78, 'quarto'),
    ]);

    // Mantém a melhor, marca as outras duas.
    expect(insights.redundantPhotoIds.sort()).toEqual(['b', 'c']);
  });

  it('não marca redundância quando as notas divergem bastante', () => {
    const insights = buildPhotoSetInsights([
      photo('a', 90, 'quarto'),
      photo('b', 60, 'quarto'),
      photo('c', 30, 'quarto'),
    ]);

    expect(insights.redundantPhotoIds).toEqual([]);
  });

  it('não marca redundância com menos de 3 fotos do ambiente', () => {
    const insights = buildPhotoSetInsights([
      photo('a', 80, 'quarto'),
      photo('b', 80, 'quarto'),
    ]);

    expect(insights.redundantPhotoIds).toEqual([]);
  });

  it('lida com conjunto vazio', () => {
    const insights = buildPhotoSetInsights([]);

    expect(insights.bestPhotoId).toBeNull();
    expect(insights.missingRooms).toHaveLength(4);
  });
});

describe('computePhotoScore', () => {
  const scoreOf = (photos: PhotoAnalysisResult[]) =>
    computePhotoScore(photos, buildPhotoSetInsights(photos));

  it('devolve um score inteiro entre 0 e 100', () => {
    const score = scoreOf([photo('a', 80), photo('b', 70), photo('c', 90)]);

    expect(Number.isInteger(score.score)).toBe(true);
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(100);
  });

  it('dá uma razão em texto para cada componente', () => {
    const score = scoreOf([photo('a', 80), photo('b', 70), photo('c', 90)]);

    for (const component of score.components) {
      expect(component.reason.length).toBeGreaterThan(10);
    }
  });

  it('pontua melhor um álbum de fotos boas', () => {
    const bom = scoreOf([
      photo('a', 90, 'sala'),
      photo('b', 88, 'quarto'),
      photo('c', 85, 'cozinha'),
      photo('d', 84, 'banheiro'),
    ]);

    const ruim = scoreOf([
      photo('a', 40, 'sala'),
      photo('b', 38, 'quarto'),
      photo('c', 35, 'cozinha'),
      photo('d', 30, 'banheiro'),
    ]);

    expect(bom.score).toBeGreaterThan(ruim.score);
  });

  it('premia cobertura completa dos ambientes esperados', () => {
    const completo = scoreOf([
      photo('a', 75, 'sala'),
      photo('b', 75, 'quarto'),
      photo('c', 75, 'cozinha'),
      photo('d', 75, 'banheiro'),
    ]);

    const incompleto = scoreOf([
      photo('a', 75, 'sala'),
      photo('b', 75, 'sala'),
      photo('c', 75, 'sala'),
      photo('d', 75, 'sala'),
    ]);

    const coverageOf = (s: typeof completo) =>
      s.components.find((c) => c.key === 'roomCoverage')!.score!;

    expect(coverageOf(completo)).toBeGreaterThan(coverageOf(incompleto));
  });

  it('premia ordenação com as melhores fotos primeiro', () => {
    const boaOrdem = scoreOf([
      photo('a', 95), photo('b', 90), photo('c', 60), photo('d', 55),
    ]);

    const maOrdem = scoreOf([
      photo('a', 55), photo('b', 60), photo('c', 90), photo('d', 95),
    ]);

    const orderingOf = (s: typeof boaOrdem) =>
      s.components.find((c) => c.key === 'ordering')!.score!;

    expect(orderingOf(boaOrdem)).toBeGreaterThan(orderingOf(maOrdem));
  });

  it('marca a ordenação como indisponível com menos de 3 fotos', () => {
    const score = scoreOf([photo('a', 80), photo('b', 70)]);
    const ordering = score.components.find((c) => c.key === 'ordering')!;

    expect(ordering.available).toBe(false);
    expect(ordering.effectiveWeight).toBe(0);
  });

  it('redistribui o peso dos componentes indisponíveis', () => {
    const score = scoreOf([photo('a', 80), photo('b', 70)]);

    const total = score.components.reduce((acc, c) => acc + c.effectiveWeight, 0);
    expect(total).toBeCloseTo(100);
  });

  it('lida com conjunto vazio sem quebrar', () => {
    const score = scoreOf([]);

    expect(score.score).toBe(0);
    expect(score.coverage).toBe(0);
  });

  it('a foto de capa pesa no resultado final', () => {
    const capaBoa = scoreOf([photo('a', 95), photo('b', 60), photo('c', 60)]);
    const capaRuim = scoreOf([photo('a', 60), photo('b', 60), photo('c', 60)]);

    expect(capaBoa.score).toBeGreaterThan(capaRuim.score);
  });
});
