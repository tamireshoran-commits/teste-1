import { GoogleGenAI } from '@google/genai';
import { getPrompt } from '@/server/core/prompts/registry';
import {
  InvalidInputError,
  ProviderError,
  RateLimitError,
  TimeoutError,
} from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';
import type { ImageInput } from '@/server/core/types';
import {
  extractJsonObject,
  parsePhotoResponse,
} from './photoResponseSchema';
import type {
  VisionAnalyzeOptions,
  VisionAnalyzeOutput,
  VisionProvider,
} from './VisionProvider';

const log = logger.child('gemini-vision');

const DEFAULT_TIMEOUT_MS = 45_000;

/** Formatos que a API aceita como `inlineData`. */
const GEMINI_SUPPORTED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export interface GeminiVisionProviderOptions {
  apiKey: string;
  model: string;
  defaultTimeoutMs?: number;
  /** Injetável para testes: evita bater na API de verdade. */
  client?: Pick<GoogleGenAI, 'models'>;
}

/**
 * Análise de imagem via Gemini.
 *
 * Uma imagem por chamada, por decisão de arquitetura: lotes grandes estouram
 * limite de payload e uma foto problemática derrubaria as outras. Paralelismo
 * é responsabilidade do `ImageAnalysisService`.
 *
 * Todo erro da API é traduzido para a hierarquia do domínio, porque é o
 * `retryable` dessas classes que o `withRetry` consulta — sem essa tradução, um
 * 429 seria tratado como falha definitiva e uma imagem corrompida seria
 * retentada três vezes queimando crédito.
 */
export class GeminiVisionProvider implements VisionProvider {
  readonly name = 'gemini';
  readonly model: string;

  private readonly client: Pick<GoogleGenAI, 'models'>;
  private readonly apiKey: string;
  private readonly defaultTimeoutMs: number;

  constructor(options: GeminiVisionProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.client =
      options.client ?? new GoogleGenAI({ apiKey: options.apiKey });
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.trim() !== '';
  }

  async analyzeImage(
    image: ImageInput,
    options: VisionAnalyzeOptions = {},
  ): Promise<VisionAnalyzeOutput> {
    this.assertUsableImage(image);

    const prompt = options.prompt ?? this.buildPrompt(image, options);
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    // AbortSignal.timeout dispara do lado do cliente; o withTimeout genérico
    // não cancelaria o socket, deixando a conexão pendurada.
    const abortSignal = AbortSignal.timeout(timeoutMs);
    const startedAt = Date.now();

    let response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;

    try {
      response = await this.client.models.generateContent({
        model: this.model,
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: image.mimeType,
                  data: Buffer.from(image.data).toString('base64'),
                },
              },
            ],
          },
        ],
        config: {
          abortSignal,
          responseMimeType: 'application/json',
          // Baixa temperatura: queremos avaliação estável, não criatividade.
          temperature: 0.2,
          maxOutputTokens: 1200,
        },
      });
    } catch (cause) {
      throw this.translateError(cause, image, timeoutMs);
    }

    const text = response.text;

    if (!text || text.trim() === '') {
      throw new ProviderError(
        'O Gemini devolveu uma resposta vazia para a imagem.',
        { provider: this.name, retryable: true },
      );
    }

    const result = parsePhotoResponse(extractJsonObject(text), image.id);

    log.debug('imagem analisada', {
      photoId: image.id,
      latencyMs: Date.now() - startedAt,
      score: result.score,
    });

    return {
      result,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        imageCount: 1,
      },
      raw: text,
    };
  }

  private assertUsableImage(image: ImageInput): void {
    if (image.data.byteLength === 0) {
      throw new InvalidInputError(
        'A imagem está vazia.',
        'INVALID_INPUT',
        { photoId: image.id },
      );
    }

    if (!GEMINI_SUPPORTED_MIME.has(image.mimeType)) {
      throw new InvalidInputError(
        `O Gemini não aceita imagens do tipo "${image.mimeType}".`,
        'UNSUPPORTED_FORMAT',
        { photoId: image.id, mimeType: image.mimeType },
      );
    }
  }

  private buildPrompt(
    image: ImageInput,
    options: VisionAnalyzeOptions,
  ): string {
    const context = options.propertyContext ?? {};

    return getPrompt('photo-analysis', {
      // Prompt sem variável definida falharia; "não informado" é honesto e
      // diz ao modelo que o dado não existe, em vez de sugerir um valor.
      propertyType: context.propertyType ?? 'não informado',
      bedrooms: context.bedrooms ?? 'não informado',
      city: context.city ?? 'não informada',
      position: image.position,
    }).text;
  }

  /**
   * Traduz o erro da API para a hierarquia do domínio.
   *
   * O SDK não expõe classes de erro tipadas por categoria, então a
   * classificação usa status HTTP quando disponível e cai para a mensagem.
   */
  private translateError(
    cause: unknown,
    image: ImageInput,
    timeoutMs: number,
  ): Error {
    if (isAbortError(cause)) {
      return new TimeoutError(`análise da imagem ${image.id}`, timeoutMs);
    }

    const status = extractStatus(cause);
    const message = extractMessage(cause);

    // O status HTTP é a evidência mais forte e por isso é consultado ANTES dos
    // padrões de mensagem. A ordem importa de verdade: um 401 de credencial
    // traz "ACCESS_TOKEN_TYPE_UNSUPPORTED" no corpo, e um filtro por
    // /unsupported/ avaliado primeiro o classificaria como imagem inválida —
    // escondendo um problema de configuração atrás de um erro de arquivo.
    if (status !== undefined) {
      if (status === 429) {
        return new RateLimitError(this.name, extractRetryAfterMs(cause));
      }

      if (status === 401 || status === 403) {
        return new ProviderError(
          `Credencial do Gemini inválida ou sem permissão: ${message}`,
          // Não adianta retentar com a mesma chave.
          { provider: this.name, retryable: false, status },
        );
      }

      if (status === 400 || status === 422) {
        // 400 aqui é quase sempre imagem que o modelo não consegue decodificar.
        return new InvalidInputError(
          `O Gemini rejeitou a imagem: ${message}`,
          'INVALID_INPUT',
          { photoId: image.id, status },
        );
      }

      if (status >= 500) {
        return new ProviderError(`Falha temporária do Gemini: ${message}`, {
          provider: this.name,
          retryable: true,
          status,
          cause,
        });
      }
    }

    // Sem status utilizável, cai para a inspeção da mensagem.
    if (/rate.?limit|quota|resource.?exhausted/i.test(message)) {
      return new RateLimitError(this.name, extractRetryAfterMs(cause));
    }

    if (/unauthenticated|permission.?denied|api.?key/i.test(message)) {
      return new ProviderError(
        `Credencial do Gemini inválida ou sem permissão: ${message}`,
        { provider: this.name, retryable: false },
      );
    }

    if (/invalid.?argument|cannot.?decode|unsupported.?(image|mime|format)/i.test(message)) {
      return new InvalidInputError(
        `O Gemini rejeitou a imagem: ${message}`,
        'INVALID_INPUT',
        { photoId: image.id },
      );
    }

    // Desconhecido: tratamos como transitório. Uma retentativa é barata
    // perto de perder a análise de uma foto por um erro de rede.
    return new ProviderError(`Erro ao chamar o Gemini: ${message}`, {
      provider: this.name,
      retryable: true,
      ...(status !== undefined ? { status } : {}),
      cause,
    });
  }
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

function extractStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  const record = error as Record<string, unknown>;

  for (const key of ['status', 'statusCode', 'code']) {
    const value = record[key];
    if (typeof value === 'number' && value >= 100 && value < 600) return value;
  }

  // O SDK às vezes embute o status na mensagem: "got status: 429 ...".
  const match = /\b(4\d{2}|5\d{2})\b/.exec(extractMessage(error));
  return match ? Number(match[1]) : undefined;
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  return String(error);
}

function extractRetryAfterMs(error: unknown): number | undefined {
  const message = extractMessage(error);

  // "retryDelay":"32s" ou Retry-After: 32
  const seconds = /retry.?(?:delay|after)"?[:\s]+"?(\d+)s?/i.exec(message);
  return seconds?.[1] ? Number(seconds[1]) * 1000 : undefined;
}
