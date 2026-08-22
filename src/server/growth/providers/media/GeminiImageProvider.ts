import { randomUUID } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import type { StorageProvider } from '@/server/core/providers/storage/StorageProvider';
import {
  ProviderError,
  RateLimitError,
  TimeoutError,
} from '@/server/core/shared/errors';
import type {
  GeneratedMedia,
  ImageGenerationInput,
  ImageProvider,
} from './MediaProvider';

const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * Geração de imagem via Gemini.
 *
 * O modelo devolve a imagem em `inlineData` (base64); nós gravamos no
 * `StorageProvider` e guardamos só a chave. Manter o arquivo do nosso lado não
 * é preciosismo: a Meta precisa baixar a mídia por URL pública na hora de
 * publicar, e URL temporária de fornecedor expira antes da aprovação humana.
 *
 * O modelo vem de `IMAGE_MODEL` porque o Google renomeia e aposenta modelos
 * com frequência — confira quais a sua chave acessa antes de fixar um valor.
 */
export class GeminiImageProvider implements ImageProvider {
  readonly name = 'gemini';

  private readonly client: Pick<GoogleGenAI, 'models'>;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly storage: StorageProvider,
    options: {
      apiKey: string;
      model: string;
      timeoutMs?: number;
      client?: Pick<GoogleGenAI, 'models'>;
    },
  ) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.client = options.client ?? new GoogleGenAI({ apiKey: options.apiKey });
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.trim() !== '';
  }

  async generateImage(input: ImageGenerationInput): Promise<GeneratedMedia> {
    const prompt =
      `${input.prompt}\n\nFormato: ${input.aspectRatio ?? '9:16'} (vertical). ` +
      'Sem texto sobreposto, sem marcas registradas, sem pessoas reais ' +
      'identificáveis.';

    let response: Awaited<
      ReturnType<GoogleGenAI['models']['generateContent']>
    >;

    try {
      response = await this.client.models.generateContent({
        model: this.model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          abortSignal: AbortSignal.timeout(this.timeoutMs),
          responseModalities: ['IMAGE'],
        },
      });
    } catch (cause) {
      throw this.translateError(cause);
    }

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const image = parts.find((part) => part.inlineData?.data !== undefined);
    const data = image?.inlineData?.data;

    if (data === undefined) {
      throw new ProviderError(
        'O modelo não devolveu imagem. Isso costuma indicar que o prompt foi ' +
          'bloqueado pelos filtros de segurança — revise a descrição da cena.',
        { provider: this.name, retryable: false },
      );
    }

    const mimeType = image?.inlineData?.mimeType ?? 'image/png';
    const key = `${input.keyPrefix}/${randomUUID()}.${extensionFor(mimeType)}`;

    await this.storage.put({
      key,
      data: Buffer.from(data, 'base64'),
      contentType: mimeType,
    });

    return {
      kind: 'IMAGE',
      provider: this.name,
      model: this.model,
      storageKey: key,
      externalUrl: null,
      durationSec: null,
      // O custo real depende da tabela do fornecedor: sem MODEL_PRICING_JSON
      // configurado, o sistema registra a geração sem inventar um valor.
      costUsd: 0,
      isMock: false,
      meta: { prompt: input.prompt, mimeType },
    };
  }

  private translateError(cause: unknown): Error {
    const message = cause instanceof Error ? cause.message : String(cause);
    const name = (cause as { name?: string } | null)?.name;

    if (name === 'AbortError' || name === 'TimeoutError') {
      return new TimeoutError(`geração de imagem com ${this.model}`, this.timeoutMs);
    }

    if (/rate.?limit|quota|resource.?exhausted|429/i.test(message)) {
      return new RateLimitError(this.name);
    }

    if (/api.?key|unauthenticated|permission.?denied|401|403/i.test(message)) {
      return new ProviderError(
        `Credencial do Gemini inválida ou sem permissão: ${message}`,
        { provider: this.name, retryable: false },
      );
    }

    if (/404|not found|no longer available/i.test(message)) {
      return new ProviderError(
        `O modelo de imagem "${this.model}" não está disponível para esta ` +
          `chave. Ajuste IMAGE_MODEL. Resposta: ${message}`,
        { provider: this.name, retryable: false },
      );
    }

    return new ProviderError(`Erro ao gerar imagem: ${message}`, {
      provider: this.name,
      retryable: true,
      cause,
    });
  }
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  return 'png';
}
