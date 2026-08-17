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
 * Tabela de preços por modelo. Mantida em um único lugar para que ajustar
 * custo não exija tocar em nenhum provider.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'mock-model': { inputPerMillion: 0, outputPerMillion: 0 },
};

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
  const pricing = MODEL_PRICING[usage.model];

  if (!pricing) {
    return {
      estimatedCostUsd: 0,
      pricingKnown: false,
      warning:
        `Modelo "${usage.model}" não está em MODEL_PRICING; ` +
        'custo não pôde ser estimado. Adicione o preço em shared/cost.ts.',
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
