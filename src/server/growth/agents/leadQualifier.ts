import { z } from 'zod';
import type {
  ConversationChannel,
  ConversationTurn,
  LeadTemperature,
  ProductSummary,
} from '../types';
import { describeHistory, describeProducts, recentTurns } from './shared';
import { runAgent, type AgentDeps, type AgentResult } from './runAgent';

/**
 * Agente 5 — Qualificador de Leads.
 *
 * Roda no modelo barato de propósito: é a chamada mais frequente do sistema
 * (uma por mensagem recebida) e a tarefa é classificação, não raciocínio.
 */

export const leadQualificationSchema = z.object({
  temperature: z.enum(['COLD', 'WARM', 'HOT', 'READY']),
  score: z.number().int().min(0).max(100),
  intent: z.string().nullable(),
  problem: z.string().nullable(),
  productId: z.string().nullable(),
  budget: z.string().nullable(),
  urgency: z.string().nullable(),
  decisionStage: z.string().nullable(),
  funnelStage: z.enum([
    'AWARENESS',
    'INTEREST',
    'CONSIDERATION',
    'DECISION',
    'RETENTION',
  ]),
  objections: z.array(z.string()).default([]),
  suggestedNextAction: z.string().default(''),
  handoffToHuman: z.boolean().default(false),
  handoffReason: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
});

export type LeadQualificationOutput = z.infer<typeof leadQualificationSchema>;

export interface LeadQualifierInput {
  brandName: string;
  language: string;
  channel: ConversationChannel;
  message: string;
  history: readonly ConversationTurn[];
  products: readonly ProductSummary[];
  sourceContent: string | null;
}

export async function runLeadQualifier(
  input: LeadQualifierInput,
  deps: AgentDeps,
): Promise<AgentResult<LeadQualificationOutput>> {
  return runAgent({
    ...deps,
    agent: 'LEAD_QUALIFIER',
    operation: 'growth:lead-qualification',
    prompt: 'growth/lead-qualification',
    schema: leadQualificationSchema,
    tier: 'cheap',
    temperature: 0.2,
    maxOutputTokens: 1500,
    variables: {
      brandName: input.brandName,
      language: input.language,
      channel: input.channel,
      message: input.message,
      history: describeHistory(recentTurns(input.history)),
      products: describeProducts(input.products),
      sourceContent: input.sourceContent ?? 'não identificado',
    },
  });
}

const TEMPERATURE_RANGE: Record<LeadTemperature, [number, number]> = {
  COLD: [0, 24],
  WARM: [25, 59],
  HOT: [60, 84],
  READY: [85, 100],
};

/**
 * Reconcilia score e temperatura.
 *
 * O modelo às vezes devolve `READY` com score 40. Em vez de descartar a
 * resposta inteira, a temperatura manda (é a decisão que o resto do sistema
 * usa) e o score é trazido para a faixa correspondente. O produto não pode
 * mostrar um funil onde lead quente tem nota de lead frio.
 */
export function reconcileScore(
  temperature: LeadTemperature,
  score: number,
): number {
  const [min, max] = TEMPERATURE_RANGE[temperature];
  return Math.min(max, Math.max(min, Math.round(score)));
}
