import type {
  BrandContext,
  ConversationTurn,
  ProductSummary,
} from '../types';

/**
 * Formatação da entrada dos prompts.
 *
 * Centralizada porque o formato do que entra no prompt é parte do contrato:
 * mudar como um produto é descrito muda a resposta do modelo, e isso precisa
 * acontecer em um lugar só, não espalhado por seis agentes.
 */

export function formatMoney(cents: number | null, currency: string): string {
  if (cents === null) return 'sob consulta';

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

/**
 * Catálogo em JSON: é a única fonte de preço e link que o agente pode citar,
 * e o guardrail depois confere o que ele escreveu contra esta mesma lista.
 */
export function describeProducts(products: readonly ProductSummary[]): string {
  if (products.length === 0) {
    return 'Nenhum produto cadastrado. Não cite preço, prazo nem link.';
  }

  return JSON.stringify(
    products.map((product) => ({
      id: product.id,
      nome: product.name,
      descricao: product.description,
      preco: formatMoney(product.priceCents, product.currency),
      beneficios: product.benefits,
      linkCompra: product.checkoutUrl ?? null,
      linkAgendamento: product.schedulingUrl ?? null,
    })),
    null,
    2,
  );
}

export function describeHistory(turns: readonly ConversationTurn[]): string {
  if (turns.length === 0) return '(sem histórico — primeira interação)';

  return turns
    .map((turn) => {
      const who = turn.direction === 'INBOUND' ? 'PESSOA' : 'MARCA';
      return `- [${turn.at.toISOString()}] ${who}: ${turn.text}`;
    })
    .join('\n');
}

export function describeList(items: readonly string[]): string {
  return items.length > 0 ? items.join('; ') : 'nenhum';
}

export function brandVariables(
  brand: BrandContext,
): Record<string, string> {
  return {
    brandName: brand.name,
    brandDescription: brand.description ?? 'não informada',
    toneOfVoice: brand.toneOfVoice,
    valueProposition: brand.valueProposition ?? 'não definida',
    doNotSay: describeList(brand.doNotSay),
    language: brand.language,
  };
}

/**
 * Últimos N turnos da conversa.
 *
 * Enviar o histórico inteiro a cada troca é o que faz o custo de uma conversa
 * longa explodir. O resumo mantido em `Conversation.summary` cobre o que ficou
 * para trás.
 */
export function recentTurns(
  turns: readonly ConversationTurn[],
  limit = 12,
): ConversationTurn[] {
  return turns.slice(-limit);
}
