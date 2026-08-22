import type { MediaKind } from '../../types';

/**
 * Contratos de geração de mídia.
 *
 * Imagem, vídeo e voz são interfaces separadas porque o mercado se move em
 * velocidades diferentes: o fornecedor de imagem de hoje não é o de vídeo, e
 * nenhum dos dois será o mesmo daqui a um ano. O sistema só depende destas
 * assinaturas — trocar de fornecedor é escrever uma classe.
 *
 * É também o item mais caro da operação: geração de vídeo domina o custo por
 * workspace, por isso `costUsd` volta em toda geração e é somado no orçamento.
 */

export interface GeneratedMedia {
  kind: MediaKind;
  provider: string;
  model: string | null;
  /** Chave no `StorageProvider`, quando o arquivo foi salvo por nós. */
  storageKey: string | null;
  /** URL externa, quando o fornecedor hospeda o arquivo. */
  externalUrl: string | null;
  durationSec: number | null;
  costUsd: number;
  isMock: boolean;
  meta?: Record<string, unknown>;
}

export interface ImageGenerationInput {
  prompt: string;
  aspectRatio?: string;
  /** Prefixo da chave de armazenamento, ex.: `growth/<workspace>/<peça>`. */
  keyPrefix: string;
}

export interface ImageProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  generateImage(input: ImageGenerationInput): Promise<GeneratedMedia>;
}

export interface VideoGenerationInput {
  /** Cenas já descritas pelo Agente 3. */
  scenes: ReadonlyArray<{
    index: number;
    durationSec: number;
    visualPrompt: string;
    narration: string;
    onScreenText: string;
  }>;
  aspectRatio: string;
  totalDurationSec: number;
  keyPrefix: string;
}

export interface VideoProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  generateVideo(input: VideoGenerationInput): Promise<GeneratedMedia>;
}

export interface SpeechGenerationInput {
  text: string;
  voice?: string;
  language: string;
  keyPrefix: string;
}

export interface SpeechProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  generateSpeech(input: SpeechGenerationInput): Promise<GeneratedMedia>;
}
