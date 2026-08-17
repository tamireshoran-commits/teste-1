import {
  DEFAULT_SCORING_CONFIG,
  type ScoringConfig,
} from './config';
import { buildScore, type ScoreComponentInput } from './buildScore';
import type { ScoreResult } from '@/server/core/types';

/**
 * Overall Competitiveness Score.
 *
 * Combina os scores das análises que rodaram. Como em toda parte do sistema,
 * dimensão sem dado não entra como zero: o peso é redistribuído e `coverage`
 * informa quanto do total pôde ser avaliado.
 *
 * "Conteúdo" e "reputação" não são análises próprias — são recortes dos scores
 * de anúncio, extraídos dos componentes que já foram calculados lá. Isso evita
 * uma segunda fórmula que poderia divergir da primeira.
 */

export interface OverallScoreInput {
  airbnb?: ScoreResult | null;
  booking?: ScoreResult | null;
  pricing?: ScoreResult | null;
  photos?: ScoreResult | null;
  config?: ScoringConfig;
}

export interface OverallScoreResult {
  overall: ScoreResult;
  /** Scores por dimensão, para os cards do dashboard. */
  breakdown: {
    airbnb: number | null;
    booking: number | null;
    pricing: number | null;
    photos: number | null;
    content: number | null;
    reputation: number | null;
  };
}

export function computeOverallScore({
  airbnb = null,
  booking = null,
  pricing = null,
  photos = null,
  config = DEFAULT_SCORING_CONFIG,
}: OverallScoreInput): OverallScoreResult {
  const weights = config.weights.overall;

  const content = extractComponent([airbnb, booking], 'content');
  const reputation = extractComponent([airbnb, booking], 'reputation');

  const components: ScoreComponentInput[] = [
    dimension('airbnb', 'Airbnb', weights.airbnb, airbnb?.score ?? null,
      airbnb ? 'Análise do anúncio do Airbnb.' : 'O anúncio do Airbnb não foi analisado.'),
    dimension('booking', 'Booking.com', weights.booking, booking?.score ?? null,
      booking ? 'Análise do anúncio do Booking.com.' : 'O anúncio do Booking.com não foi analisado.'),
    dimension('pricing', 'Pricing', weights.pricing, pricing?.score ?? null,
      pricing ? 'Análise do CSV do PriceLabs.' : 'Nenhum dado de pricing foi enviado.'),
    dimension('photos', 'Fotos', weights.photos, photos?.score ?? null,
      photos ? 'Análise visual das fotos.' : 'Nenhuma foto foi analisada.'),
    dimension('content', 'Conteúdo', weights.content, content,
      content !== null
        ? 'Média do eixo de conteúdo dos anúncios analisados.'
        : 'Requer ao menos um anúncio analisado.'),
    dimension('reputation', 'Reputação', weights.reputation, reputation,
      reputation !== null
        ? 'Média do eixo de reputação dos anúncios analisados.'
        : 'Requer ao menos um anúncio analisado.'),
  ];

  return {
    overall: buildScore(components, config.version),
    breakdown: {
      airbnb: airbnb?.score ?? null,
      booking: booking?.score ?? null,
      pricing: pricing?.score ?? null,
      photos: photos?.score ?? null,
      content,
      reputation,
    },
  };
}

function dimension(
  key: string,
  label: string,
  weight: number,
  score: number | null,
  reason: string,
): ScoreComponentInput {
  return { key, label, weight, score, available: score !== null, reason };
}

/** Média de um componente presente em mais de um score de anúncio. */
function extractComponent(
  scores: ReadonlyArray<ScoreResult | null>,
  key: string,
): number | null {
  const values = scores
    .filter((s): s is ScoreResult => s !== null)
    .map((s) => s.components.find((c) => c.key === key))
    .filter((c) => c?.available === true && c.score !== null)
    .map((c) => c!.score!);

  if (values.length === 0) return null;

  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}
