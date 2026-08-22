import { z } from 'zod';
import type {
  BrandContext,
  ConversationChannel,
  ConversationTurn,
  ProductSummary,
} from '../types';
import {
  checkPublicText,
  hasBlockingViolation,
  type GuardrailViolation,
} from '../policy/guardrails';
import {
  brandVariables,
  describeHistory,
  describeList,
  describeProducts,
  recentTurns,
} from './shared';
import { runAgent, type AgentDeps, type AgentResult } from './runAgent';

/**
 * Agente 6 — Vendedor por IA.
 *
 * O agente que fala em nome da marca com uma pessoa real. Duas decisões
 * definem o comportamento dele:
 *
 * 1. **Cache desligado.** Duas pessoas com a mesma pergunta não podem receber
 *    a mesma resposta literal — é o que faz a conversa parecer robô.
 * 2. **Saída conferida por guardrail determinístico.** O prompt pede para não
 *    prometer resultado e não inventar preço; a checagem garante. Quando a
 *    mensagem viola, ela não é enviada: vira transferência para humano.
 */

export const salesReplySchema = z.object({
  message: z.string().min(1),
  intent: z.string().default(''),
  stage: z.enum([
    'QUALIFYING',
    'PRESENTING',
    'HANDLING_OBJECTION',
    'CLOSING',
    'SUPPORT',
  ]),
  objectionsAddressed: z.array(z.string()).default([]),
  shouldSendCheckout: z.boolean().default(false),
  productId: z.string().nullable().default(null),
  handoffToHuman: z.boolean().default(false),
  handoffReason: z.string().nullable().default(null),
  followUpReason: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
});

export type SalesReplyOutput = z.infer<typeof salesReplySchema>;

export interface SalesRepInput {
  brand: BrandContext;
  channel: ConversationChannel;
  message: string;
  history: readonly ConversationTurn[];
  products: readonly ProductSummary[];
  /** Objeções conhecidas da estratégia, já com resposta aprovada. */
  knownObjections: readonly string[];
  leadSummary: string;
}

export interface SalesReplyResult {
  reply: SalesReplyOutput;
  violations: GuardrailViolation[];
  /** false quando o guardrail bloqueou: a mensagem não pode ser enviada. */
  safeToSend: boolean;
}

export async function runSalesRep(
  input: SalesRepInput,
  deps: AgentDeps,
): Promise<AgentResult<SalesReplyResult>> {
  const result = await runAgent({
    ...deps,
    // Conversa de venda nunca vem do cache.
    cache: undefined,
    agent: 'SALES_REP',
    operation: 'growth:sales-reply',
    prompt: 'growth/sales-reply',
    schema: salesReplySchema,
    tier: 'smart',
    temperature: 0.7,
    maxOutputTokens: 1200,
    variables: {
      ...brandVariables(input.brand),
      channel: input.channel,
      message: input.message,
      history: describeHistory(recentTurns(input.history)),
      products: describeProducts(input.products),
      objections: describeList(input.knownObjections),
      leadSummary: input.leadSummary,
    },
  });

  const violations = checkPublicText(result.data.message, {
    doNotSay: input.brand.doNotSay,
    allowedPriceCents: input.products
      .map((p) => p.priceCents)
      .filter((cents): cents is number => cents !== null),
    allowedUrls: input.products.flatMap((p) =>
      [p.checkoutUrl, p.schedulingUrl].filter(
        (url): url is string => url !== null,
      ),
    ),
    maxLength: 900,
  });

  const blocked = hasBlockingViolation(violations);

  return {
    ...result,
    data: {
      reply: result.data,
      violations,
      safeToSend: !blocked,
    },
  };
}

/**
 * Resolve o link de compra a partir do catálogo.
 *
 * O agente indica **qual produto**; a URL vem do banco. É por isso que ele não
 * consegue enviar um link inventado mesmo que escreva um no texto — o
 * guardrail barra o texto, e o link real nunca depende do que o modelo digitou.
 */
export function resolveCheckoutUrl(
  productId: string | null,
  products: readonly ProductSummary[],
): { url: string; productId: string } | null {
  if (productId === null) return null;

  const product = products.find((p) => p.id === productId);
  if (!product) return null;

  const url = product.checkoutUrl ?? product.schedulingUrl;
  if (!url) return null;

  return { url, productId: product.id };
}
