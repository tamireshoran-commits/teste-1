import { ProviderError } from '@/server/core/shared/errors';
import type { LLMProvider, LLMRequest, LLMResponse } from './LLMProvider';

/**
 * LLM simulado, para rodar o fluxo sem credencial e sem custo.
 *
 * Não tenta imitar um modelo: devolve uma resposta fixa por operação,
 * registrada no construtor. Se ninguém registrou resposta para o que foi
 * pedido, **falha** em vez de improvisar — um mock que inventa conteúdo
 * plausível esconderia bugs e poderia vazar texto fictício para o relatório.
 */
export class MockLLMProvider implements LLMProvider {
  readonly name = 'mock';
  readonly model = 'mock-model';

  private readonly responses = new Map<string, unknown>();

  constructor(responses: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(responses)) {
      this.responses.set(key, value);
    }
  }

  /** Registra a resposta devolvida quando o prompt contiver `marker`. */
  register(marker: string, response: unknown): this {
    this.responses.set(marker, response);
    return this;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async completeJSON<T>(request: LLMRequest<T>): Promise<LLMResponse<T>> {
    const match = [...this.responses.entries()].find(([marker]) =>
      request.prompt.includes(marker),
    );

    if (!match) {
      throw new ProviderError(
        'MockLLMProvider não tem resposta registrada para este prompt. ' +
          'Registre uma com `register(marcador, resposta)` — o mock não ' +
          'inventa conteúdo.',
        { provider: this.name, retryable: false },
      );
    }

    return {
      data: request.parse(match[1]),
      usage: { inputTokens: 0, outputTokens: 0 },
      model: this.model,
      raw: match[1],
    };
  }
}
