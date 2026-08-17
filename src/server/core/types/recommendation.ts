import type { Difficulty, ImpactLevel, StepType } from './common';

export type RecommendationCategory =
  | 'PHOTOS'
  | 'CONTENT'
  | 'AMENITIES'
  | 'PRICING'
  | 'REPUTATION'
  | 'POLICIES'
  | 'COMPETITIVENESS';

/**
 * Recomendação acionável.
 *
 * `evidence` é obrigatório em espírito: uma recomendação sem dado que a
 * sustente é palpite, e o produto não entrega palpite como diagnóstico.
 */
export interface Recommendation {
  id?: string;
  title: string;
  description: string;
  category: RecommendationCategory;
  priority: ImpactLevel;
  estimatedImpact: ImpactLevel;
  difficulty: Difficulty;
  /** 0..1. */
  confidence: number;
  /** Por que esta recomendação existe, em linguagem de hipótese. */
  reason: string;
  /** O que o usuário deve fazer, concretamente. */
  action: string;
  evidence: Record<string, unknown>;
  sourceStep?: StepType;
  /** Ordem de exibição, calculada pelo ranking de impacto. */
  rank?: number;
}

export interface RecommendationBuckets {
  /** "🔴 Corrija primeiro" — as 3 a 5 maiores oportunidades. */
  fixFirst: Recommendation[];
  /** "🟡 Melhorias recomendadas". */
  improvements: Recommendation[];
  /** "🟢 Pontos fortes" — o que já está bom e deve ser preservado. */
  strengths: string[];
}
