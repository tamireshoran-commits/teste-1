import { randomUUID } from 'node:crypto';
import type { StorageProvider } from '@/server/core/providers/storage/StorageProvider';
import type {
  GeneratedMedia,
  ImageGenerationInput,
  ImageProvider,
  SpeechGenerationInput,
  SpeechProvider,
  VideoGenerationInput,
  VideoProvider,
} from './MediaProvider';

/**
 * Geradores simulados.
 *
 * Produzem **arquivos reais** (um SVG, um storyboard, um roteiro de narração)
 * em vez de devolver uma URL falsa: assim o painel tem o que exibir, o fluxo
 * de aprovação é testável de ponta a ponta e ninguém confunde o resultado com
 * uma peça pronta — o arquivo diz, na própria imagem, que é um exemplo.
 */

export class MockImageProvider implements ImageProvider {
  readonly name = 'mock';

  constructor(private readonly storage: StorageProvider) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async generateImage(input: ImageGenerationInput): Promise<GeneratedMedia> {
    const key = `${input.keyPrefix}/${randomUUID()}.svg`;
    const svg = placeholderSvg(input.prompt, input.aspectRatio ?? '9:16');

    await this.storage.put({
      key,
      data: new TextEncoder().encode(svg),
      contentType: 'image/svg+xml',
    });

    return {
      kind: 'IMAGE',
      provider: this.name,
      model: null,
      storageKey: key,
      externalUrl: null,
      durationSec: null,
      costUsd: 0,
      isMock: true,
      meta: { prompt: input.prompt },
    };
  }
}

export class MockVideoProvider implements VideoProvider {
  readonly name = 'mock';

  constructor(private readonly storage: StorageProvider) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async generateVideo(input: VideoGenerationInput): Promise<GeneratedMedia> {
    const key = `${input.keyPrefix}/${randomUUID()}.storyboard.json`;

    const storyboard = {
      aviso:
        'Storyboard simulado. Nenhum vídeo foi renderizado — configure ' +
        'VIDEO_PROVIDER=EXTERNAL e uma API de geração de vídeo para produzir ' +
        'o arquivo final.',
      aspectRatio: input.aspectRatio,
      totalDurationSec: input.totalDurationSec,
      scenes: input.scenes,
    };

    await this.storage.put({
      key,
      data: new TextEncoder().encode(JSON.stringify(storyboard, null, 2)),
      contentType: 'application/json',
    });

    return {
      kind: 'VIDEO',
      provider: this.name,
      model: null,
      storageKey: key,
      externalUrl: null,
      durationSec: input.totalDurationSec,
      costUsd: 0,
      isMock: true,
      meta: { rendered: false, scenes: input.scenes.length },
    };
  }
}

export class MockSpeechProvider implements SpeechProvider {
  readonly name = 'mock';

  constructor(private readonly storage: StorageProvider) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async generateSpeech(input: SpeechGenerationInput): Promise<GeneratedMedia> {
    const key = `${input.keyPrefix}/${randomUUID()}.narration.txt`;

    await this.storage.put({
      key,
      data: new TextEncoder().encode(input.text),
      contentType: 'text/plain; charset=utf-8',
    });

    return {
      kind: 'AUDIO',
      provider: this.name,
      model: null,
      storageKey: key,
      externalUrl: null,
      // ~150 palavras por minuto de locução em português.
      durationSec: Math.round((input.text.split(/\s+/).length / 150) * 60),
      costUsd: 0,
      isMock: true,
      meta: { rendered: false },
    };
  }
}

function placeholderSvg(prompt: string, aspectRatio: string): string {
  const [w, h] = aspectRatio === '1:1' ? [1080, 1080] : [1080, 1920];
  const lines = wrap(prompt, 34).slice(0, 12);

  const text = lines
    .map(
      (line, index) =>
        `<tspan x="60" dy="${index === 0 ? 0 : 46}">${escapeXml(line)}</tspan>`,
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#111827"/>
  <text x="60" y="140" fill="#f97316" font-family="sans-serif" font-size="40" font-weight="bold">EXEMPLO — imagem simulada</text>
  <text x="60" y="240" fill="#e5e7eb" font-family="sans-serif" font-size="34">${text}</text>
</svg>`;
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if ((current + ' ' + word).trim().length > width) {
      if (current !== '') lines.push(current.trim());
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }

  if (current.trim() !== '') lines.push(current.trim());

  return lines;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
