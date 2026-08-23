import { z } from 'zod';
import type { BrandContext, ConversationTurn, ProductSummary } from '../types';
import { checkPublicText, hasBlockingViolation } from '../policy/guardrails';
import {
  brandVariables,
  describeHistory,
  describeProducts,
  recentTurns,
} from './shared';
import { runAgent, type AgentDeps, type AgentResult } from './runAgent';

/**
 * Redator de follow-up.
 *
 * Faz parte do Agente 6, mas com prompt próprio: retomar uma conversa parada é
 * uma tarefa diferente de responder alguém que acabou de escrever. O campo
 * `shouldSend` existe para o agente poder dizer "não tenho nada de novo a
 * dizer" — sem essa saída, todo follow-up vira "oi, tudo bem?".
 */

export const followUpSchema = z.object({
  shouldSend: z.boolean(),
  message: z.string().default(''),
  skipReason: z.string().nullable().default(null),
  isLastAttempt: z.boolean().default(false),
});

export type FollowUpOutput = z.infer<typeof followUpSchema>;

export interface FollowUpInput {
  brand: BrandContext;
  products: readonly ProductSummary[];
  reason: string;
  attempt: number;
  maxAttempts: number;
  daysSinceLast: number;
  leadSummary: string;
  history: readonly ConversationTurn[];
}

export interface FollowUpResult {
  followUp: FollowUpOutput;
  safeToSend: boolean;
  violations: ReturnType<typeof checkPublicText>;
}

export async function runFollowUpWriter(
  input: FollowUpInput,
  deps: AgentDeps,
): Promise<AgentResult<FollowUpResult>> {
  const result = await runAgent({
    ...deps,
    cache: undefined,
    agent: 'SALES_REP',
    operation: 'growth:follow-up',
    prompt: 'growth/follow-up',
    schema: followUpSchema,
    // Retoma uma conversa: também enxerga o histórico do cliente.
    tier: 'private',
    temperature: 0.6,
    maxOutputTokens: 800,
    variables: {
      ...brandVariables(input.brand),
      products: describeProducts(input.products),
      reason: input.reason,
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
      daysSinceLast: input.daysSinceLast,
      leadSummary: input.leadSummary,
      history: describeHistory(recentTurns(input.history)),
    },
  });

  const violations = result.data.shouldSend
    ? checkPublicText(result.data.message, {
        doNotSay: input.brand.doNotSay,
        allowedPriceCents: input.products
          .map((p) => p.priceCents)
          .filter((cents): cents is number => cents !== null),
        allowedUrls: input.products.flatMap((p) =>
          [p.checkoutUrl, p.schedulingUrl].filter(
            (url): url is string => url !== null,
          ),
        ),
        maxLength: 600,
      })
    : [];

  return {
    ...result,
    data: {
      followUp: result.data,
      violations,
      safeToSend:
        result.data.shouldSend &&
        result.data.message.trim() !== '' &&
        !hasBlockingViolation(violations),
    },
  };
}
