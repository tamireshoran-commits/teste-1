import { randomUUID } from 'node:crypto';
import type { StorageProvider } from '@/server/core/providers/storage/StorageProvider';
import {
  ProviderError,
  RateLimitError,
  TimeoutError,
} from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';
import type {
  GeneratedMedia,
  ImageGenerationInput,
  ImageProvider,
} from './MediaProvider';

const log = logger.child('image-openai-compatible');
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Geração de imagem por endpoint `/v1/images/generations`.
 *
 * Mesmo raciocínio do provider de texto: um gateway (OmniRoute e afins) expõe
 * dezenas de geradores atrás de um contrato só, incluindo os gratuitos. Como a
 * imagem é o segundo item mais caro da operação, poder trocar de fornecedor
 * por variável de ambiente vale mais aqui do que em qualquer outro lugar.
 *
 * O arquivo é sempre gravado no nosso `StorageProvider`, mesmo quando o
 * fornecedor devolve URL: link temporário expira antes da aprovação humana, e
 * a Meta precisa baixar a mídia na hora de publicar.
 */
export interface OpenAICompatibleImageOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  label?: string;
}

interface ImageResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string };
}

export class OpenAICompatibleImageProvider implements ImageProvider {
  readonly name: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly storage: StorageProvider,
    options: OpenAICompatibleImageOptions,
  ) {
    this.name = options.label ?? 'openai-compatible';
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async isAvailable(): Promise<boolean> {
    return this.baseUrl !== '' && this.apiKey !== '';
  }

  async generateImage(input: ImageGenerationInput): Promise<GeneratedMedia> {
    const size = sizeFor(input.aspectRatio ?? '9:16');

    const payload = await this.post({
      model: this.model,
      prompt:
        `${input.prompt}\n\nSem texto sobreposto, sem marcas registradas, ` +
        'sem pessoas reais identificáveis.',
      n: 1,
      size,
      response_format: 'b64_json',
    });

    const first = payload.data?.[0];

    if (!first) {
      throw new ProviderError(
        'O gerador de imagem não devolveu nenhum resultado.',
        { provider: this.name, retryable: true },
      );
    }

    const bytes =
      first.b64_json !== undefined
        ? Buffer.from(first.b64_json, 'base64')
        : await this.download(first.url);

    const key = `${input.keyPrefix}/${randomUUID()}.png`;

    await this.storage.put({ key, data: bytes, contentType: 'image/png' });

    return {
      kind: 'IMAGE',
      provider: this.name,
      model: this.model,
      storageKey: key,
      externalUrl: null,
      durationSec: null,
      // Preço por imagem varia por fornecedor roteado e não vem na resposta.
      // Registrar zero é honesto; inventar um valor não seria.
      costUsd: 0,
      isMock: false,
      meta: { prompt: input.prompt, size },
    };
  }

  private async post(body: Record<string, unknown>): Promise<ImageResponse> {
    let response: Response;

    try {
      response = await this.fetchImpl(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      if (isAbortError(cause)) {
        throw new TimeoutError('geração de imagem', this.timeoutMs);
      }

      throw new ProviderError(
        `Falha de rede ao gerar imagem em ${this.baseUrl}: ${describe(cause)}`,
        { provider: this.name, retryable: true, cause },
      );
    }

    const raw = await response.text();
    let payload: ImageResponse;

    try {
      payload = JSON.parse(raw) as ImageResponse;
    } catch {
      payload = { error: { message: raw.slice(0, 300) } };
    }

    if (!response.ok || payload.error !== undefined) {
      const message = payload.error?.message ?? raw.slice(0, 300);

      if (response.status === 429) throw new RateLimitError(this.name);

      throw new ProviderError(`Falha ao gerar imagem: ${message}`, {
        provider: this.name,
        retryable: response.status >= 500,
        status: response.status,
      });
    }

    return payload;
  }

  private async download(url: string | undefined): Promise<Buffer> {
    if (url === undefined) {
      throw new ProviderError(
        'A resposta não trouxe nem imagem nem URL.',
        { provider: this.name, retryable: true },
      );
    }

    log.debug('baixando imagem do fornecedor', { url });

    const response = await this.fetchImpl(url, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new ProviderError(
        `Não foi possível baixar a imagem gerada (HTTP ${response.status}).`,
        { provider: this.name, retryable: true },
      );
    }

    return Buffer.from(await response.arrayBuffer());
  }
}

/** Proporção → tamanho aceito pela maioria dos geradores. */
function sizeFor(aspectRatio: string): string {
  if (aspectRatio === '1:1') return '1024x1024';
  if (aspectRatio === '16:9') return '1792x1024';
  return '1024x1792';
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
