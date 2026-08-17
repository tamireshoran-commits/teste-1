import { z } from 'zod';

/**
 * Estimativa de custo das chamadas de IA.
 *
 * Os preços abaixo são **estimativas de configuração**, não valores oficiais
 * cobrados: eles servem para o produto medir e limitar gasto, e devem ser
 * revisados contra a tabela de preços de cada fornecedor antes de virar
 * cobrança para o cliente final. Preço desconhecido => custo 0 e um aviso,
 * nunca um número inventado.
 */

export type AIProviderName = 'GEMINI' | 'ANTHROPIC' | 'OPENAI' | 'MOCK';

export interface ModelPricing {
  /** USD por 1 milhão de tokens de entrada. */
  inputPerMillion: number;
  /** USD por 1 milhão de tokens de saída. */
  outputPerMillion: number;
}

/**
 * Tabela de preços por modelo.
 *
 * Só o mock vem preenchido, e de propósito. Os preços dos fornecedores mudam,
 * variam por região e por tier — chutar um valor aqui produziria um número que
 * *parece* verdade no relatório de custo do usuário e não é. Preço é
 * configuração do operador, não constante de código.
 *
 * Para habilitar a estimativa, informe `MODEL_PRICING_JSON` no ambiente com os
 * valores da tabela oficial do fornecedor. Enquanto isso, os **tokens são
 * registrados de verdade** no `AIUsageLog` e o custo aparece como desconhecido.
 */
const BUILTIN_PRICING: Record<string, ModelPricing> = {
  'mock-model': { inputPerMillion: 0, outputPerMillion: 0 },
};

const pricingSchema = z.record(
  z.string(),
  z.object({
    inputPerMillion: z.number().nonnegative(),
    outputPerMillion: z.number().nonnegative(),
  }),
);

let overridesCache: Record<string, ModelPricing> | null = null;

function loadOverrides(): Record<string, ModelPricing> {
  if (overridesCache !== null) return overridesCache;

  const raw = process.env['MODEL_PRICING_JSON'];

  if (!raw || raw.trim() === '') {
    overridesCache = {};
    return overridesCache;
  }

  try {
    overridesCache = pricingSchema.parse(JSON.parse(raw));
  } catch {
    // Configuração malformada não pode derrubar uma análise; o efeito é o
    // mesmo de não ter preço: custo reportado como desconhecido.
    overridesCache = {};
  }

  return overridesCache;
}

/** Limpa o cache da tabela de preços — usado em testes. */
export function resetPricingCache(): void {
  overridesCache = null;
}

export function getModelPricing(model: string): ModelPricing | undefined {
  return loadOverrides()[model] ?? BUILTIN_PRICING[model];
}

/** @deprecated Use `getModelPricing`, que considera os overrides de ambiente. */
export const MODEL_PRICING = BUILTIN_PRICING;

export interface UsageInput {
  provider: AIProviderName;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  imageCount?: number;
}

export interface CostEstimate {
  estimatedCostUsd: number;
  /** false quando o modelo não está na tabela — o custo real é desconhecido. */
  pricingKnown: boolean;
  warning?: string;
}

export function estimateCost(usage: UsageInput): CostEstimate {
  const pricing = getModelPricing(usage.model);

  if (!pricing) {
    return {
      estimatedCostUsd: 0,
      pricingKnown: false,
      warning:
        `Sem preço configurado para o modelo "${usage.model}"; os tokens foram ` +
        'registrados, mas o custo não pôde ser estimado. Informe os valores ' +
        'da tabela oficial do fornecedor em MODEL_PRICING_JSON.',
    };
  }

  const inputCost =
    ((usage.inputTokens ?? 0) / 1_000_000) * pricing.inputPerMillion;
  const outputCost =
    ((usage.outputTokens ?? 0) / 1_000_000) * pricing.outputPerMillion;

  return {
    estimatedCostUsd: inputCost + outputCost,
    pricingKnown: true,
  };
}

/**
 * Acumulador de custo por análise. O pipeline consulta `wouldExceed` antes de
 * disparar uma chamada cara, evitando estourar o orçamento no meio do lote.
 */
export class CostTracker {
  private spentUsd = 0;
  private readonly entries: Array<UsageInput & { costUsd: number }> = [];

  constructor(private readonly limitUsd: number) {}

  record(usage: UsageInput): CostEstimate {
    const estimate = estimateCost(usage);
    this.spentUsd += estimate.estimatedCostUsd;
    this.entries.push({ ...usage, costUsd: estimate.estimatedCostUsd });
    return estimate;
  }

  get totalUsd(): number {
    return this.spentUsd;
  }

  get remainingUsd(): number {
    return Math.max(0, this.limitUsd - this.spentUsd);
  }

  wouldExceed(additionalUsd: number): boolean {
    return this.spentUsd + additionalUsd > this.limitUsd;
  }

  snapshot(): ReadonlyArray<UsageInput & { costUsd: number }> {
    return [...this.entries];
  }
}
