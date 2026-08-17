import { InvalidInputError } from '@/server/core/shared/errors';
import { sha256 } from '@/server/core/shared/cache';
import type { ImageInput } from '@/server/core/types';

/**
 * Validação de imagens antes de qualquer chamada de IA.
 *
 * Rejeitar cedo é o que impede gastar crédito com um arquivo que o modelo
 * recusaria de qualquer forma. A checagem é feita pelos **bytes iniciais**, não
 * pela extensão nem pelo `Content-Type` enviado pelo navegador — os dois são
 * controlados pelo cliente e mentem com facilidade.
 */

export const SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

/** Assinaturas de formato ("magic bytes"). */
const SIGNATURES: ReadonlyArray<{
  mimeType: SupportedMimeType;
  extension: string;
  matches: (bytes: Uint8Array) => boolean;
}> = [
  {
    mimeType: 'image/jpeg',
    extension: 'jpg',
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mimeType: 'image/png',
    extension: 'png',
    matches: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mimeType: 'image/webp',
    extension: 'webp',
    // RIFF....WEBP
    matches: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  {
    mimeType: 'image/heic',
    extension: 'heic',
    // ....ftypheic / heix / mif1
    matches: (b) => hasFtypBrand(b, ['heic', 'heix', 'hevc', 'mif1']),
  },
  {
    mimeType: 'image/heif',
    extension: 'heif',
    matches: (b) => hasFtypBrand(b, ['heif', 'msf1']),
  },
];

function hasFtypBrand(bytes: Uint8Array, brands: readonly string[]): boolean {
  if (bytes.length < 12) return false;

  const ftyp = String.fromCharCode(...bytes.slice(4, 8));
  if (ftyp !== 'ftyp') return false;

  const brand = String.fromCharCode(...bytes.slice(8, 12));
  return brands.includes(brand);
}

export interface DetectedFormat {
  mimeType: SupportedMimeType;
  extension: string;
}

/** Identifica o formato pelos bytes iniciais, ou `null` se não reconhecido. */
export function detectImageFormat(bytes: Uint8Array): DetectedFormat | null {
  if (bytes.length < 12) return null;

  for (const signature of SIGNATURES) {
    if (signature.matches(bytes)) {
      return { mimeType: signature.mimeType, extension: signature.extension };
    }
  }

  return null;
}

export interface ValidateImageOptions {
  maxSizeBytes: number;
  /** Nome original, apenas para a mensagem de erro. */
  fileName?: string;
}

export interface ValidatedImage {
  data: Uint8Array;
  mimeType: SupportedMimeType;
  extension: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Valida uma imagem e devolve seus metadados confiáveis.
 *
 * Lança `InvalidInputError` (não retentável) — repetir um arquivo inválido só
 * queimaria orçamento.
 */
export function validateImage(
  bytes: Uint8Array,
  options: ValidateImageOptions,
): ValidatedImage {
  const label = options.fileName ? `"${options.fileName}"` : 'a imagem';

  if (bytes.byteLength === 0) {
    throw new InvalidInputError(
      `O arquivo ${label} está vazio.`,
      'INVALID_INPUT',
      { fileName: options.fileName },
    );
  }

  if (bytes.byteLength > options.maxSizeBytes) {
    const actualMb = (bytes.byteLength / 1_048_576).toFixed(1);
    const limitMb = (options.maxSizeBytes / 1_048_576).toFixed(1);

    throw new InvalidInputError(
      `O arquivo ${label} tem ${actualMb} MB e excede o limite de ${limitMb} MB.`,
      'FILE_TOO_LARGE',
      { fileName: options.fileName, sizeBytes: bytes.byteLength },
    );
  }

  const format = detectImageFormat(bytes);

  if (!format) {
    throw new InvalidInputError(
      `O arquivo ${label} não é uma imagem em formato suportado ` +
        `(${SUPPORTED_MIME_TYPES.join(', ')}).`,
      'UNSUPPORTED_FORMAT',
      { fileName: options.fileName },
    );
  }

  return {
    data: bytes,
    mimeType: format.mimeType,
    extension: format.extension,
    sizeBytes: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

/** Monta o `ImageInput` do domínio a partir de bytes já validados. */
export function toImageInput(
  validated: ValidatedImage,
  meta: { id: string; position: number; fileName?: string },
): ImageInput {
  return {
    id: meta.id,
    data: validated.data,
    mimeType: validated.mimeType,
    ...(meta.fileName !== undefined ? { fileName: meta.fileName } : {}),
    sizeBytes: validated.sizeBytes,
    position: meta.position,
    sha256: validated.sha256,
  };
}
