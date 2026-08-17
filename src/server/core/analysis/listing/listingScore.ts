import {
  buildScore,
  type ScoreComponentInput,
} from '@/server/core/analysis/scoring/buildScore';
import {
  DEFAULT_SCORING_CONFIG,
  type ScoringConfig,
} from '@/server/core/analysis/scoring/config';
import { clamp, normalize } from '@/server/core/shared/math';
import type { ListingData, ScoreResult } from '@/server/core/types';
import { countByTier, totalInTier } from './amenities';
import type { ListingChecks } from './checks';

/**
 * Airbnb Score e Booking Score (0-100).
 *
 * Compartilham a maior parte dos componentes; a diferença está no último eixo:
 * o Airbnb é avaliado por **apresentação** (superhost, reserva instantânea,
 * completude) e o Booking por **políticas** (cancelamento, café da manhã,
 * tipos de quarto), que é o que a plataforma expõe na comparação.
 *
 * Como no pricing, componente sem dado é marcado indisponível e tem o peso
 * redistribuído — não vira zero.
 */

export interface ListingScoreInput {
  listing: ListingData;
  checks: ListingChecks;
  /** Photo Score da Etapa 3, quando houver fotos analisadas. */
  photoScore?: number | null;
  config?: ScoringConfig;
}

export function computeListingScore({
  listing,
  checks,
  photoScore = null,
  config = DEFAULT_SCORING_CONFIG,
}: ListingScoreInput): ScoreResult {
  const isAirbnb = listing.platform === 'AIRBNB';
  const weights = isAirbnb ? config.weights.airbnb : config.weights.booking;

  const components: ScoreComponentInput[] = [
    scoreContent(listing, weights.content),
    scorePhotos(listing, photoScore, weights.photos),
    scoreAmenities(checks, weights.amenities),
    scoreReputation(listing, checks, weights.reputation),
    isAirbnb
      ? scorePresentation(listing, checks, config.weights.airbnb.presentation)
      : scorePolicies(listing, config.weights.booking.policies),
    scoreCompetitiveness(checks, weights.competitiveness),
  ];

  return buildScore(components, config.version);
}

/** Título e descrição: existência, tamanho e densidade de informação. */
function scoreContent(listing: ListingData, weight: number): ScoreComponentInput {
  const base = { key: 'content', label: 'Conteúdo', weight };

  const title = listing.title?.trim() ?? '';
  const description = listing.description?.trim() ?? '';

  if (title === '' && description === '') {
    return {
      ...base,
      score: 0,
      available: true,
      reason: 'O anúncio não tem título nem descrição.',
    };
  }

  // Título: 0 se ausente, cheio entre 40 e 60 caracteres.
  const titleScore =
    title === ''
      ? 0
      : title.length > 90
        ? 55
        : 100 * clamp(normalize(title.length, 15, 40), 0.3, 1);

  // Descrição: cresce até 600 caracteres e satura.
  const descriptionScore =
    description === '' ? 0 : 100 * clamp(normalize(description.length, 80, 600), 0.2, 1);

  const score = titleScore * 0.4 + descriptionScore * 0.6;

  const reason =
    title === ''
      ? `Sem título; descrição com ${description.length} caracteres.`
      : description === ''
        ? `Título com ${title.length} caracteres, mas sem descrição.`
        : `Título com ${title.length} e descrição com ${description.length} ` +
          'caracteres.';

  return { ...base, score, available: true, reason };
}

/**
 * Fotos.
 *
 * Usa o Photo Score da análise visual quando ele existe. Sem ele, avalia só a
 * **quantidade** — e diz isso na razão, para o relatório não sugerir que a
 * qualidade das imagens foi julgada.
 */
function scorePhotos(
  listing: ListingData,
  photoScore: number | null,
  weight: number,
): ScoreComponentInput {
  const base = { key: 'photos', label: 'Fotos', weight };
  const count = listing.photos.length;

  if (photoScore !== null) {
    return {
      ...base,
      score: photoScore,
      available: true,
      reason:
        `Photo Score de ${Math.round(photoScore)}/100 a partir da análise ` +
        `visual das ${count} foto(s).`,
    };
  }

  if (count === 0) {
    return {
      ...base,
      score: 0,
      available: true,
      reason: 'O anúncio não tem fotos.',
    };
  }

  // 20 fotos é o patamar em que a quantidade deixa de ser o gargalo.
  const score = 100 * normalize(count, 1, 20);

  return {
    ...base,
    score,
    available: true,
    reason:
      `${count} foto(s) no anúncio. Apenas a quantidade foi avaliada — ` +
      'a análise visual das imagens não foi executada.',
  };
}

/** Cobertura do catálogo, com peso maior nas essenciais. */
function scoreAmenities(
  checks: ListingChecks,
  weight: number,
): ScoreComponentInput {
  const base = { key: 'amenities', label: 'Comodidades', weight };
  const { present } = checks.amenities;

  const essential = countByTier(present, 'ESSENTIAL') / totalInTier('ESSENTIAL');
  const expected = countByTier(present, 'EXPECTED') / totalInTier('EXPECTED');
  const differentiators = countByTier(present, 'DIFFERENTIATOR');

  // Diferenciais somam bônus até 3 itens; não punimos quem não tem piscina.
  const bonus = Math.min(differentiators, 3) / 3;

  const score = 100 * (essential * 0.5 + expected * 0.35 + bonus * 0.15);

  const missingEssential = checks.amenities.missing.filter(
    (a) => a.tier === 'ESSENTIAL',
  );

  const reason =
    missingEssential.length > 0
      ? `Faltam comodidades essenciais: ${missingEssential.map((a) => a.label).join(', ')}.`
      : `Todas as essenciais declaradas, com ${differentiators} diferencial(is).`;

  return { ...base, score, available: true, reason };
}

/**
 * Reputação: nota ponderada pela confiança que o volume de avaliações dá.
 *
 * Uma nota 5,0 com 2 avaliações não vale o mesmo que 4,8 com 300 — por isso a
 * nota é puxada para a média até o anúncio acumular histórico.
 */
function scoreReputation(
  listing: ListingData,
  checks: ListingChecks,
  weight: number,
): ScoreComponentInput {
  const base = { key: 'reputation', label: 'Reputação', weight };
  const rating = checks.normalizedRating;
  const reviews = listing.reviewCount;

  if (rating === null && reviews === undefined) {
    return {
      ...base,
      score: null,
      available: false,
      reason: 'O anúncio não informou nota nem quantidade de avaliações.',
    };
  }

  if (rating === null) {
    return {
      ...base,
      score: null,
      available: false,
      reason: `Nota não informada (${reviews} avaliações declaradas).`,
    };
  }

  if (reviews === undefined || reviews === 0) {
    return {
      ...base,
      score: 30,
      available: true,
      reason:
        'Sem avaliações registradas, a reputação ainda não sustenta a decisão ' +
        'de reserva.',
    };
  }

  // Encolhimento bayesiano simples: com 30+ avaliações a nota vale integral.
  const confidence = clamp(reviews / 30, 0, 1);
  const priorScore = 70;
  const score = rating * confidence + priorScore * (1 - confidence);

  const reason =
    confidence >= 1
      ? `Nota ${listing.rating} com ${reviews} avaliações — volume suficiente ` +
        'para a nota ser representativa.'
      : `Nota ${listing.rating} com apenas ${reviews} avaliação(ões); o valor ` +
        'ainda oscila e por isso pesa menos no score.';

  return { ...base, score, available: true, reason };
}

/** Airbnb: completude e sinais de qualidade da plataforma. */
function scorePresentation(
  listing: ListingData,
  checks: ListingChecks,
  weight: number,
): ScoreComponentInput {
  const base = { key: 'presentation', label: 'Apresentação', weight };

  const signals = [
    listing.propertyType !== undefined,
    listing.bedrooms !== undefined,
    listing.maxGuests !== undefined,
    listing.checkIn !== undefined && listing.checkOut !== undefined,
    listing.houseRules.length > 0,
    listing.isSuperhost === true,
    listing.instantBook === true,
  ];

  const score = (signals.filter(Boolean).length / signals.length) * 100;

  const reason =
    checks.missingInfo.length === 0
      ? 'Todos os campos de apresentação estão preenchidos.'
      : `${checks.missingInfo.length} campo(s) não preenchido(s): ` +
        `${checks.missingInfo.slice(0, 4).join(', ')}` +
        `${checks.missingInfo.length > 4 ? '…' : ''}.`;

  return { ...base, score, available: true, reason };
}

/** Booking: políticas que a plataforma expõe na comparação. */
function scorePolicies(
  listing: ListingData,
  weight: number,
): ScoreComponentInput {
  const base = { key: 'policies', label: 'Políticas', weight };

  const policy = listing.cancellationPolicy?.toLowerCase() ?? '';

  const flexible = /flex|gratuit|free/.test(policy);
  const strict = /rigoros|strict|não reembols|nao reembols|non-refundable/.test(policy);

  const signals: Array<[boolean, number]> = [
    [policy !== '', 20],
    [flexible, 25],
    [!strict, 15],
    [listing.breakfastIncluded === true, 15],
    [listing.checkIn !== undefined && listing.checkOut !== undefined, 15],
    [(listing.roomTypes?.length ?? 0) > 0, 10],
  ];

  const score = signals.reduce((acc, [ok, points]) => acc + (ok ? points : 0), 0);

  const reason = strict
    ? `Política "${listing.cancellationPolicy}" é restritiva e tende a reduzir ` +
      'a conversão frente a concorrentes mais flexíveis.'
    : flexible
      ? 'Política de cancelamento flexível, favorável à conversão.'
      : policy === ''
        ? 'Política de cancelamento não informada.'
        : `Política "${listing.cancellationPolicy}" em patamar intermediário.`;

  return { ...base, score, available: true, reason };
}

/**
 * Competitividade: derivada da severidade dos problemas encontrados.
 *
 * Não compara com concorrentes reais — não temos dados deles, e inventá-los
 * seria ficção. O que este eixo mede é quanto o anúncio se afasta das boas
 * práticas que as próprias plataformas publicam.
 */
function scoreCompetitiveness(
  checks: ListingChecks,
  weight: number,
): ScoreComponentInput {
  const base = { key: 'competitiveness', label: 'Competitividade', weight };

  const high = checks.findings.filter((f) => f.severity === 'HIGH').length;
  const medium = checks.findings.filter((f) => f.severity === 'MEDIUM').length;
  const low = checks.findings.filter((f) => f.severity === 'LOW').length;

  const penalty = high * 18 + medium * 8 + low * 3;
  const score = clamp(100 - penalty, 0, 100);

  const reason =
    checks.findings.length === 0
      ? 'Nenhum desvio das boas práticas das plataformas foi detectado.'
      : `${high} problema(s) de alta severidade, ${medium} de média e ` +
        `${low} de baixa em relação às boas práticas das plataformas. ` +
        'Não é comparação com concorrentes reais.';

  return { ...base, score, available: true, reason };
}
