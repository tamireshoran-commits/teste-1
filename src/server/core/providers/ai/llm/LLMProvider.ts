/**
 * Contrato de geração de texto/JSON.
 *
 * Abstrai OpenAI, Anthropic e Google atrás da mesma forma, para que a escolha
 * de fornecedor seja configuração e não decisão de arquitetura.
 */
export interface LLMProvider {
  readonly name: string;

  isAvailable(): Promise<boolean>;

  /**
   * Completa um prompt devolvendo JSON estruturado.
   *
   * A validação do formato é do chamador (com Zod) — o provider só garante
   * que o texto devolvido é JSON parseável, ou lança.
   */
  completeJSON<T>(request: LLMRequest<T>): Promise<LLMResponse<T>>;
}

export interface LLMRequest<T> {
  /** Prompt de sistema, vindo do PromptRegistry. */
  system?: string;
  /** Prompt do usuário, já com as variáveis interpoladas. */
  prompt: string;
  /**
   * Valida e tipa a resposta. Recebe o JSON cru e devolve o objeto tipado,
   * ou lança se o modelo devolveu algo fora do contrato.
   */
  parse: (raw: unknown) => T;
  /**
   * Escolhe o modelo concreto, e é decisão do chamador:
   *
   * - `cheap`: classificação e extração, volume alto, tarefa simples;
   * - `smart`: raciocínio que vale o custo (estratégia, plano de conteúdo);
   * - `private`: **a chamada vê dado pessoal de um cliente**.
   *
   * `private` existe por privacidade, não por capacidade. Um roteador de
   * modelos pode mandar `cheap` para o fornecedor gratuito da vez — muitos
   * treinam com o que recebem, e conversa de cliente não pode ir para lá. Sem
   * esse terceiro nível, a única forma de proteger a conversa seria pagar por
   * tudo, inclusive pelo que não tem dado de ninguém.
   */
  tier?: ModelTier;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export type ModelTier = 'cheap' | 'smart' | 'private';

export interface ModelsByTier {
  cheap: string;
  smart: string;
  /** Ausente = usa o `smart`, que é o padrão seguro (mais capaz e pago). */
  private?: string | undefined;
}

/** Mapeia o nível pedido para o modelo configurado. */
export function modelForTier(
  tier: ModelTier | undefined,
  models: ModelsByTier,
): string {
  if (tier === 'smart') return models.smart;
  if (tier === 'private') return models.private ?? models.smart;

  return models.cheap;
}

export interface LLMResponse<T> {
  data: T;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
  };
  model: string;
  raw?: unknown;
}
