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
   * 'cheap' para tarefas simples, 'smart' só quando realmente necessário.
   * O provider mapeia para o modelo concreto.
   */
  tier?: 'cheap' | 'smart';
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
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
