import { z } from 'zod';
import type { BrandContext, ProductSummary } from '../types';
import { brandVariables, describeProducts } from './shared';
import { runAgent, type AgentDeps, type AgentResult } from './runAgent';

/**
 * Agente 1 — Estrategista de Mercado.
 *
 * Produz a base que todos os outros agentes consomem: persona, dores,
 * objeções, concorrentes, proposta de valor e oferta. É o único agente que
 * roda com o modelo caro por padrão — errar aqui contamina todo o resto.
 */

export const marketStrategySchema = z.object({
  niche: z.string().min(3),
  persona: z.object({
    name: z.string(),
    ageRange: z.string(),
    occupation: z.string(),
    context: z.string(),
    channels: z.array(z.string()),
    buyingTriggers: z.array(z.string()),
  }),
  pains: z.array(z.string()).min(1),
  desires: z.array(z.string()).min(1),
  objections: z
    .array(z.object({ objection: z.string(), response: z.string() }))
    .min(1),
  competitors: z.array(
    z.object({
      archetype: z.string(),
      strengths: z.array(z.string()),
      weaknesses: z.array(z.string()),
      gap: z.string(),
    }),
  ),
  opportunities: z.array(
    z.object({
      title: z.string(),
      rationale: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  valueProposition: z.string().min(10),
  offer: z.object({
    headline: z.string(),
    promise: z.string(),
    deliverables: z.array(z.string()),
    priceHypothesis: z.string(),
    riskReversal: z.string(),
  }),
  toneOfVoice: z.string(),
  /** O que ainda é chute e precisa de dado real antes de virar investimento. */
  hypotheses: z.array(z.string()).default([]),
});

export type MarketStrategyOutput = z.infer<typeof marketStrategySchema>;

export interface MarketStrategistInput {
  brief: string;
  niche: string;
  brand: BrandContext;
  products: readonly ProductSummary[];
}

export async function runMarketStrategist(
  input: MarketStrategistInput,
  deps: AgentDeps,
): Promise<AgentResult<MarketStrategyOutput>> {
  return runAgent({
    ...deps,
    agent: 'MARKET_STRATEGIST',
    operation: 'growth:market-strategy',
    prompt: 'growth/market-strategy',
    schema: marketStrategySchema,
    // Estratégia roda uma vez por nicho e define tudo que vem depois: é o
    // lugar certo para gastar com o modelo melhor.
    tier: 'smart',
    temperature: 0.6,
    maxOutputTokens: 6000,
    variables: {
      ...brandVariables(input.brand),
      brief: input.brief,
      niche: input.niche,
      products: describeProducts(input.products),
    },
  });
}
