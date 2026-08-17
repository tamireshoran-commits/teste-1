import {
  buildScore,
  type ScoreComponentInput,
} from '@/server/core/analysis/scoring/buildScore';
import {
  DEFAULT_SCORING_CONFIG,
  type ScoringConfig,
} from '@/server/core/analysis/scoring/config';
import { mean } from '@/server/core/shared/math';
import type {
  PhotoAnalysisResult,
  PhotoSetInsights,
  ScoreResult,
} from '@/server/core/types';
import { EXPECTED_ROOMS } from './insights';

/**
 * Photo Score (0-100).
 *
 * Como no pricing, cada componente devolve nota **e razão em texto**, e um
 * componente sem dado é marcado indisponível em vez de virar zero.
 */
export function computePhotoScore(
  photos: readonly PhotoAnalysisResult[],
  insights: PhotoSetInsights,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
): ScoreResult {
  const w = config.weights.photos;

  const components: ScoreComponentInput[] = [
    scoreCoverPhoto(photos, insights, w.coverPhoto),
    scoreAverageQuality(photos, w.averageQuality),
    scoreVariety(photos, w.variety),
    scoreRoomCoverage(insights, w.roomCoverage),
    scoreOrdering(photos, w.ordering),
    scoreDimension(photos, 'professionalism', 'Profissionalismo', w.professionalism),
    scoreDimension(photos, 'valuePerception', 'Percepção de valor', w.valuePerception),
  ];

  return buildScore(components, config.version);
}

/** A primeira foto decide o clique. Pesa mais que qualquer outra isolada. */
function scoreCoverPhoto(
  photos: readonly PhotoAnalysisResult[],
  insights: PhotoSetInsights,
  weight: number,
): ScoreComponentInput {
  const base = { key: 'coverPhoto', label: 'Foto de capa', weight };
  const cover = photos[0];

  if (!cover) {
    return {
      ...base,
      score: null,
      available: false,
      reason: 'Nenhuma foto foi analisada com sucesso.',
    };
  }

  const reason =
    insights.suggestedCoverPhotoId !== null
      ? `A foto de capa tem nota ${cover.score}/100, enquanto a melhor foto do ` +
        'conjunto é mais forte por uma margem relevante.'
      : `A foto de capa tem nota ${cover.score}/100 e é a mais forte do conjunto.`;

  return { ...base, score: cover.score, available: true, reason };
}

function scoreAverageQuality(
  photos: readonly PhotoAnalysisResult[],
  weight: number,
): ScoreComponentInput {
  const base = { key: 'averageQuality', label: 'Qualidade média', weight };
  const average = mean(photos.map((p) => p.score));

  if (average === null) {
    return {
      ...base,
      score: null,
      available: false,
      reason: 'Nenhuma foto foi analisada com sucesso.',
    };
  }

  const weak = photos.filter((p) => p.score < 60).length;

  const reason =
    weak === 0
      ? `Nota média de ${average.toFixed(0)}/100 nas ${photos.length} fotos ` +
        'analisadas, sem imagens fracas.'
      : `Nota média de ${average.toFixed(0)}/100; ${weak} de ${photos.length} ` +
        'fotos ficaram abaixo de 60.';

  return { ...base, score: average, available: true, reason };
}

/**
 * Variedade = quantos ambientes distintos aparecem.
 *
 * Escala até 6 ambientes; acima disso já é um álbum variado e não faz sentido
 * continuar premiando.
 */
function scoreVariety(
  photos: readonly PhotoAnalysisResult[],
  weight: number,
): ScoreComponentInput {
  const base = { key: 'variety', label: 'Variedade de ambientes', weight };

  if (photos.length === 0) {
    return {
      ...base,
      score: null,
      available: false,
      reason: 'Nenhuma foto foi analisada com sucesso.',
    };
  }

  const distinct = new Set(photos.map((p) => p.roomType)).size;
  const TARGET = 6;
  const score = Math.min(100, (distinct / TARGET) * 100);

  return {
    ...base,
    score,
    available: true,
    reason:
      `${distinct} ambiente(s) distinto(s) entre ${photos.length} foto(s). ` +
      `A referência usada é de ${TARGET} ambientes.`,
  };
}

/** Cobertura dos ambientes que o hóspede espera ver antes de reservar. */
function scoreRoomCoverage(
  insights: PhotoSetInsights,
  weight: number,
): ScoreComponentInput {
  const base = { key: 'roomCoverage', label: 'Cobertura dos ambientes', weight };

  if (insights.coveredRooms.length === 0) {
    return {
      ...base,
      score: null,
      available: false,
      reason: 'Nenhuma foto foi analisada com sucesso.',
    };
  }

  const covered = EXPECTED_ROOMS.filter(
    (room) => !insights.missingRooms.includes(room),
  );

  // Ambiente coberto só por foto fraca conta metade.
  const weakPenalty = insights.weaklyCoveredRooms.filter((room) =>
    (EXPECTED_ROOMS as readonly string[]).includes(room),
  ).length;

  const effective = Math.max(0, covered.length - weakPenalty * 0.5);
  const score = (effective / EXPECTED_ROOMS.length) * 100;

  const reason =
    insights.missingRooms.length === 0
      ? 'Todos os ambientes esperados (sala, quarto, cozinha, banheiro) têm foto.'
      : `Sem foto de: ${insights.missingRooms.join(', ')}.`;

  return { ...base, score, available: true, reason };
}

/**
 * Ordenação: as melhores fotos devem vir primeiro.
 *
 * Medimos a correlação entre posição e nota — se as notas caem conforme a
 * posição avança, a ordem está boa.
 */
function scoreOrdering(
  photos: readonly PhotoAnalysisResult[],
  weight: number,
): ScoreComponentInput {
  const base = { key: 'ordering', label: 'Ordem das fotos', weight };

  if (photos.length < 3) {
    return {
      ...base,
      score: null,
      available: false,
      reason: 'São necessárias ao menos 3 fotos para avaliar a ordem.',
    };
  }

  const firstHalf = photos.slice(0, Math.ceil(photos.length / 2));
  const secondHalf = photos.slice(Math.ceil(photos.length / 2));

  const firstAvg = mean(firstHalf.map((p) => p.score))!;
  const secondAvg = mean(secondHalf.map((p) => p.score))!;

  const delta = firstAvg - secondAvg;

  // +10 ou mais de vantagem na primeira metade = ordem ótima.
  // Vantagem invertida de -10 = ordem ruim.
  const score = Math.min(100, Math.max(0, ((delta + 10) / 20) * 100));

  const reason =
    delta >= 0
      ? `A primeira metade das fotos tem nota média ${delta.toFixed(0)} ponto(s) ` +
        'acima da segunda, o que favorece a primeira impressão.'
      : `A segunda metade das fotos tem nota média ${Math.abs(delta).toFixed(0)} ` +
        'ponto(s) acima da primeira; reordenar é uma oportunidade potencial.';

  return { ...base, score, available: true, reason };
}

/** Média de uma dimensão específica das análises individuais. */
function scoreDimension(
  photos: readonly PhotoAnalysisResult[],
  key: 'professionalism' | 'valuePerception',
  label: string,
  weight: number,
): ScoreComponentInput {
  const base = { key, label, weight };
  const average = mean(photos.map((p) => p[key]));

  if (average === null) {
    return {
      ...base,
      score: null,
      available: false,
      reason: 'Nenhuma foto foi analisada com sucesso.',
    };
  }

  return {
    ...base,
    score: average,
    available: true,
    reason: `Média de ${average.toFixed(0)}/100 em ${label.toLowerCase()} nas fotos analisadas.`,
  };
}
