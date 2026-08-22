import { z } from 'zod';
import type { BrandContext, ProductSummary } from '../types';
import { brandVariables, describeList, describeProducts } from './shared';
import { runAgent, type AgentDeps, type AgentResult } from './runAgent';
import type { MarketStrategyOutput } from './marketStrategist';

/**
 * Agente 2 — Estrategista de Conteúdo.
 *
 * Transforma a estratégia em calendário executável. Recebe também os insights
 * do módulo de aprendizado: é este ponto que fecha o laço entre o que foi
 * publicado, o que converteu e o que será publicado a seguir.
 */

export const contentPieceSchema = z.object({
  objective: z.enum(['REACH', 'ENGAGEMENT', 'LEADS', 'SALES']),
  format: z.enum(['REEL', 'CAROUSEL', 'IMAGE', 'STORY', 'TEXT']),
  funnelStage: z.enum([
    'AWARENESS',
    'INTEREST',
    'CONSIDERATION',
    'DECISION',
    'RETENTION',
  ]),
  audience: z.string(),
  theme: z.string(),
  hook: z.string(),
  script: z.string(),
  caption: z.string(),
  cta: z.string(),
  keywords: z.array(z.string()).default([]),
  dayOffset: z.number().int().min(0).max(365),
  rationale: z.string().default(''),
});

export const contentPlanSchema = z.object({
  pillars: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        share: z.number().min(0).max(1),
      }),
    )
    .min(1),
  pieces: z.array(contentPieceSchema).min(1),
});

export type ContentPlanOutput = z.infer<typeof contentPlanSchema>;
export type ContentPieceOutput = z.infer<typeof contentPieceSchema>;

export interface ContentStrategistInput {
  brand: BrandContext;
  strategy: Pick<
    MarketStrategyOutput,
    'persona' | 'pains' | 'desires' | 'objections' | 'valueProposition'
  >;
  products: readonly ProductSummary[];
  periodStart: Date;
  periodEnd: Date;
  pieceCount: number;
  /** Frases prontas vindas do módulo de aprendizado. Vazio na primeira rodada. */
  insights: readonly string[];
}

export async function runContentStrategist(
  input: ContentStrategistInput,
  deps: AgentDeps,
): Promise<AgentResult<ContentPlanOutput>> {
  return runAgent({
    ...deps,
    agent: 'CONTENT_STRATEGIST',
    operation: 'growth:content-plan',
    prompt: 'growth/content-plan',
    schema: contentPlanSchema,
    tier: 'smart',
    temperature: 0.7,
    maxOutputTokens: 8000,
    variables: {
      ...brandVariables(input.brand),
      valueProposition: input.strategy.valueProposition,
      persona: JSON.stringify(input.strategy.persona),
      pains: describeList(input.strategy.pains),
      desires: describeList(input.strategy.desires),
      objections: describeList(
        input.strategy.objections.map((o) => `${o.objection} → ${o.response}`),
      ),
      products: describeProducts(input.products),
      periodStart: input.periodStart.toISOString().slice(0, 10),
      periodEnd: input.periodEnd.toISOString().slice(0, 10),
      pieceCount: input.pieceCount,
      insights:
        input.insights.length > 0
          ? input.insights.map((i) => `- ${i}`).join('\n')
          : 'Nenhum dado de desempenho ainda. Trate este calendário como ' +
            'primeira rodada de testes e varie temas e ganchos de propósito.',
    },
  });
}
