import { z } from 'zod';

/**
 * Validação centralizada das variáveis de ambiente.
 *
 * Nenhuma credencial é lida diretamente de `process.env` fora deste módulo —
 * assim o app falha no boot com uma mensagem clara em vez de estourar em
 * runtime no meio de uma análise.
 */

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const positiveNumber = (fallback: number) =>
  z.coerce.number().positive().default(fallback);

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),

  AUTH_SECRET: z.string().min(1, 'AUTH_SECRET é obrigatória'),
  AUTH_URL: z.string().url().default('http://localhost:3000'),

  // Providers de dados — trocáveis por env, sem alterar código de domínio.
  AIRBNB_PROVIDER: z.enum(['MOCK', 'MANUAL']).default('MOCK'),
  BOOKING_PROVIDER: z.enum(['MOCK', 'MANUAL']).default('MOCK'),
  PRICING_PROVIDER: z
    .enum(['CSV_PRICELABS', 'PRICELABS_API'])
    .default('CSV_PRICELABS'),

  // Providers de IA.
  VISION_PROVIDER: z
    .enum(['MOCK', 'GEMINI', 'ANTHROPIC', 'OPENAI'])
    .default('MOCK'),
  /**
   * OPENAI_COMPATIBLE cobre qualquer endpoint que fale `/v1/chat/completions`:
   * gateways como o OmniRoute, a própria OpenAI, OpenRouter, Groq, ou um
   * modelo local. É a opção que permite rotear cada chamada para o fornecedor
   * mais barato disponível sem tocar em código.
   */
  LLM_PROVIDER: z
    .enum(['MOCK', 'GEMINI', 'ANTHROPIC', 'OPENAI', 'OPENAI_COMPATIBLE'])
    .default('MOCK'),

  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  /**
   * Endereço do endpoint compatível com OpenAI. Ex.: `http://localhost:20128/v1`
   * (OmniRoute na porta padrão). Vazio com LLM_PROVIDER=OPENAI significa a API
   * oficial da OpenAI.
   */
  LLM_BASE_URL: z.string().url().optional(),
  /** Chave do endpoint acima. Sem ela, cai para OPENAI_API_KEY. */
  LLM_API_KEY: z.string().optional(),
  /**
   * Pede JSON estruturado via `response_format`. Alguns modelos roteados não
   * aceitam esse campo; desligue se o gateway reclamar (a requisição já é
   * refeita sem ele automaticamente, mas desligar evita a ida perdida).
   */
  LLM_JSON_MODE: booleanish.default(true),

  /**
   * Modelos padrão.
   *
   * Verificados contra a API em 2026-08. O Google retira modelos antigos do
   * acesso de contas novas — `gemini-2.5-flash` já responde 404 para elas —
   * então confira com `GET /v1beta/models` antes de fixar um valor aqui.
   * Os aliases `*-latest` não expiram, ao custo de o modelo mudar sob você.
   */
  VISION_MODEL: z.string().default('gemini-3.5-flash-lite'),
  LLM_MODEL_CHEAP: z.string().default('gemini-3.5-flash-lite'),
  LLM_MODEL_SMART: z.string().default('gemini-3.5-flash'),

  // Fotos analisadas em paralelo. Baixo de propósito: rajada grande dispara
  // rate limit, e o retry sai mais caro que a espera.
  VISION_CONCURRENCY: positiveNumber(3),
  VISION_TIMEOUT_MS: positiveNumber(45_000),
  VISION_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  VISION_CACHE_TTL_DAYS: positiveNumber(30),

  /**
   * Tabela de preços por modelo, em JSON. Sem ela, o sistema registra os
   * tokens reais mas informa custo desconhecido — nunca um valor inventado.
   * Formato: {"gemini-2.5-flash":{"inputPerMillion":0.1,"outputPerMillion":0.4}}
   */
  MODEL_PRICING_JSON: z.string().optional(),

  STORAGE_PROVIDER: z.enum(['LOCAL', 'S3']).default('LOCAL'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),

  MAX_PHOTOS_PER_ANALYSIS: positiveNumber(30),
  MAX_PHOTO_SIZE_MB: positiveNumber(10),
  MAX_CSV_SIZE_MB: positiveNumber(10),
  MAX_COST_PER_ANALYSIS_USD: positiveNumber(1),

  DEBUG_LOGS: booleanish.default(false),

  // ---------------------------------------------------------------------------
  // Growth Engine — marketing e vendas por agentes
  // ---------------------------------------------------------------------------

  /**
   * Integrações sociais. MOCK deixa todo o fluxo rodável sem App Review da
   * Meta: nada é publicado nem enviado de verdade, e o resultado carrega
   * `isMock: true` para a interface rotular.
   */
  SOCIAL_PROVIDER: z.enum(['MOCK', 'META']).default('MOCK'),
  IMAGE_PROVIDER: z
    .enum(['MOCK', 'GEMINI', 'OPENAI_COMPATIBLE'])
    .default('MOCK'),
  VIDEO_PROVIDER: z.enum(['MOCK', 'EXTERNAL']).default('MOCK'),
  TTS_PROVIDER: z.enum(['MOCK', 'EXTERNAL']).default('MOCK'),

  /**
   * Versão da Graph API fixada de propósito: a Meta expira versões em cerca de
   * dois anos e muda o formato de resposta entre elas. Subir aqui é uma
   * decisão consciente, não um efeito colateral de deploy.
   */
  META_GRAPH_VERSION: z.string().default('v21.0'),
  /** Segredo do app — usado para validar a assinatura do webhook. */
  META_APP_SECRET: z.string().optional(),
  /** Token que a Meta ecoa na verificação do webhook (hub.verify_token). */
  META_VERIFY_TOKEN: z.string().optional(),
  /**
   * Token padrão de acesso. O token por conta vem de `SocialAccount.tokenRef`,
   * que guarda o NOME de uma variável de ambiente — nunca o token em si.
   */
  META_ACCESS_TOKEN: z.string().optional(),

  IMAGE_MODEL: z.string().default('gemini-3.5-flash-image'),

  /** Quantos jobs o worker processa por tick. */
  GROWTH_WORKER_BATCH_SIZE: positiveNumber(5),
  /** Tempo após o qual um job travado (worker morto) volta para a fila. */
  GROWTH_JOB_LOCK_TIMEOUT_MS: positiveNumber(300_000),
  /**
   * Janela de resposta da Meta, em horas. Fora dela nenhuma DM sai — nem no
   * modo autônomo. Configurável porque a Meta já mudou esse número.
   */
  GROWTH_MESSAGE_WINDOW_HOURS: positiveNumber(24),
  /** Teto de custo de IA por workspace por dia, em USD. */
  GROWTH_MAX_DAILY_COST_USD: positiveNumber(2),
  /** Protege o endpoint de tick do worker chamado por cron externo. */
  CRON_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');

    throw new Error(
      `Variáveis de ambiente inválidas:\n${issues}\n\n` +
        'Copie .env.example para .env e preencha os valores obrigatórios.',
    );
  }

  return parsed.data;
}

let cached: Env | undefined;

/**
 * Carrega e valida o ambiente na primeira chamada.
 * Usa Proxy para que o import do módulo não exploda em contextos (como testes
 * unitários de domínio puro) que nunca tocam em nenhuma variável.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    cached ??= loadEnv();
    return cached[prop as keyof Env];
  },
});

/** Limpa o cache — usado apenas em testes. */
export function resetEnvCache(): void {
  cached = undefined;
}
