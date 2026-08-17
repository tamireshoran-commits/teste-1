import { describe, expect, it } from 'vitest';
import {
  detectImageFormat,
  validateImage,
} from '@/server/core/analysis/photos/imageValidation';
import { InvalidInputError } from '@/server/core/shared/errors';

/** Cabeçalhos reais de cada formato, seguidos de preenchimento. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array(20).fill(0)]);
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(20).fill(0),
]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, ...Array(20).fill(0),
]);
const HEIC = new Uint8Array([
  0x00, 0x00, 0x00, 0x18,
  ...[...'ftyp'].map((c) => c.charCodeAt(0)),
  ...[...'heic'].map((c) => c.charCodeAt(0)),
  ...Array(20).fill(0),
]);

describe('detectImageFormat', () => {
  it('reconhece JPEG, PNG, WebP e HEIC pelos bytes iniciais', () => {
    expect(detectImageFormat(JPEG)).toEqual({
      mimeType: 'image/jpeg',
      extension: 'jpg',
    });
    expect(detectImageFormat(PNG)).toEqual({
      mimeType: 'image/png',
      extension: 'png',
    });
    expect(detectImageFormat(WEBP)).toEqual({
      mimeType: 'image/webp',
      extension: 'webp',
    });
    expect(detectImageFormat(HEIC)).toEqual({
      mimeType: 'image/heic',
      extension: 'heic',
    });
  });

  it('devolve null para conteúdo que não é imagem', () => {
    const pdf = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, ...Array(20).fill(0),
    ]);

    expect(detectImageFormat(pdf)).toBeNull();
  });

  it('devolve null para conteúdo curto demais para conter assinatura', () => {
    expect(detectImageFormat(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe('validateImage', () => {
  const options = { maxSizeBytes: 10 * 1024 * 1024 };

  it('aceita uma imagem válida e devolve metadados confiáveis', () => {
    const result = validateImage(JPEG, options);

    expect(result.mimeType).toBe('image/jpeg');
    expect(result.extension).toBe('jpg');
    expect(result.sizeBytes).toBe(JPEG.byteLength);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produz o mesmo hash para o mesmo conteúdo', () => {
    expect(validateImage(JPEG, options).sha256).toBe(
      validateImage(new Uint8Array(JPEG), options).sha256,
    );
  });

  it('produz hashes diferentes para conteúdos diferentes', () => {
    expect(validateImage(JPEG, options).sha256).not.toBe(
      validateImage(PNG, options).sha256,
    );
  });

  it('rejeita arquivo vazio', () => {
    expect(() => validateImage(new Uint8Array(0), options)).toThrow(
      InvalidInputError,
    );
  });

  it('rejeita arquivo acima do limite, informando os tamanhos', () => {
    const big = new Uint8Array(2000);
    big.set(JPEG.slice(0, 4));

    expect(() => validateImage(big, { maxSizeBytes: 1000 })).toThrow(
      /excede o limite/,
    );

    try {
      validateImage(big, { maxSizeBytes: 1000 });
    } catch (error) {
      expect((error as InvalidInputError).code).toBe('FILE_TOO_LARGE');
    }
  });

  it('rejeita formato não suportado mesmo com nome de arquivo enganoso', () => {
    // Um .pdf renomeado para .jpg não passa: a checagem é por bytes.
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, ...Array(20).fill(0)]);

    try {
      validateImage(pdf, { ...options, fileName: 'foto.jpg' });
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      expect((error as InvalidInputError).code).toBe('UNSUPPORTED_FORMAT');
    }
  });

  it('erros de validação nunca são retentáveis', () => {
    // Repetir um arquivo inválido só queimaria orçamento.
    for (const bad of [new Uint8Array(0), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])]) {
      try {
        validateImage(bad, options);
      } catch (error) {
        expect((error as InvalidInputError).retryable).toBe(false);
      }
    }
  });
});
