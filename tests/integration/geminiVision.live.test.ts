import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ImageAnalysisService } from '@/server/core/analysis/photos/ImageAnalysisService';
import {
  toImageInput,
  validateImage,
} from '@/server/core/analysis/photos/imageValidation';
import { buildPhotoSetInsights } from '@/server/core/analysis/photos/insights';
import { computePhotoScore } from '@/server/core/analysis/photos/photoScore';
import { GeminiVisionProvider } from '@/server/core/providers/ai/vision/GeminiVisionProvider';
import { InMemoryCacheStore } from '@/server/core/shared/cache';
import { NoopUsageRecorder } from '@/server/core/shared/usage';

/**
 * Teste de integração contra a API real do Gemini.
 *
 * Roda apenas quando `GEMINI_API_KEY` está no ambiente — sem a chave, os testes
 * são pulados em vez de falhar, para não quebrar o CI nem o clone de quem não
 * tem credencial. Consome cota de verdade, então mantém uma única imagem.
 *
 *   GEMINI_API_KEY=... npx vitest run tests/integration
 */

const apiKey = process.env['GEMINI_API_KEY']?.trim();
const model = process.env['VISION_MODEL']?.trim() || 'gemini-2.5-flash';

const describeLive = apiKey ? describe : describe.skip;

/** Gera uma sala sintética em PNG, sem depender de arquivo binário no repo. */
function buildSyntheticRoomPng(): Uint8Array {
  const W = 320;
  const H = 240;
  const px = new Uint8Array(W * H * 3);

  const set = (x: number, y: number, r: number, g: number, b: number) => {
    const i = (y * W + x) * 3;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (y > H * 0.68) {
        const t = (y - H * 0.68) / (H * 0.32);
        set(x, y, 150 - t * 40, 105 - t * 30, 65 - t * 20);
      } else {
        const shade = 232 - (y / H) * 25;
        set(x, y, shade, shade - 4, shade - 12);
      }
    }
  }

  for (let y = 45; y < 130; y++) {
    for (let x = 200; x < 280; x++) set(x, y, 252, 252, 245);
  }
  for (let y = 150; y < 200; y++) {
    for (let x = 35; x < 165; x++) set(x, y, 74, 84, 96);
  }

  return encodePng(W, H, px);
}

function encodePng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;

  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[o++] = pixels[i]!;
      raw[o++] = pixels[i + 1]!;
      raw[o++] = pixels[i + 2]!;
    }
  }

  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let table: Int32Array | null = null;
function crc32(buf: Buffer): number {
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }

  let c = 0xffffffff;
  for (const byte of buf) c = table[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return c ^ 0xffffffff;
}

describeLive('GeminiVisionProvider (API real)', () => {
  const provider = new GeminiVisionProvider({ apiKey: apiKey!, model });

  it('analisa uma imagem real e devolve o contrato completo', async () => {
    const validated = validateImage(buildSyntheticRoomPng(), {
      maxSizeBytes: 10 * 1_048_576,
      fileName: 'sala.png',
    });

    expect(validated.mimeType).toBe('image/png');

    const image = toImageInput(validated, { id: 'foto-capa', position: 0 });

    const output = await provider.analyzeImage(image, {
      propertyContext: {
        propertyType: 'apartamento',
        bedrooms: 2,
        city: 'Florianópolis',
      },
    });

    const r = output.result;

    expect(r.photoId).toBe('foto-capa');
    expect(typeof r.roomType).toBe('string');
    expect(r.roomType.length).toBeGreaterThan(0);

    for (const value of [
      r.score, r.lighting, r.visualQuality, r.composition,
      r.professionalism, r.valuePerception, r.clarity,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }

    expect(Array.isArray(r.strengths)).toBe(true);
    expect(Array.isArray(r.problems)).toBe(true);
    expect(Array.isArray(r.recommendations)).toBe(true);

    // A contagem de tokens precisa chegar de verdade, senão o AIUsageLog
    // registraria zero e o controle de custo seria fictício.
    expect(output.usage.inputTokens).toBeGreaterThan(0);
    expect(output.usage.outputTokens).toBeGreaterThan(0);
    expect(output.usage.imageCount).toBe(1);
  }, 90_000);

  it('roda o pipeline completo: análise, cache, telemetria e score', async () => {
    const validated = validateImage(buildSyntheticRoomPng(), {
      maxSizeBytes: 10 * 1_048_576,
    });

    const images = [toImageInput(validated, { id: 'p0', position: 0 })];

    const cache = new InMemoryCacheStore();
    const recorder = new NoopUsageRecorder();
    const service = new ImageAnalysisService(provider, { cache, usageRecorder: recorder });

    const first = await service.analyzeBatch(images, { analysisId: 'live-1' });

    expect(first.results).toHaveLength(1);
    expect(first.failures).toHaveLength(0);
    expect(recorder.entries).toHaveLength(1);
    expect(recorder.entries[0]).toMatchObject({
      analysisId: 'live-1',
      provider: 'gemini',
      operation: 'photo-analysis',
      success: true,
    });
    expect(recorder.entries[0]!.inputTokens).toBeGreaterThan(0);

    // Segunda passada: mesma imagem, deve vir do cache sem nova chamada.
    const second = await service.analyzeBatch(images, { analysisId: 'live-1' });

    expect(second.cacheHits).toBe(1);
    expect(second.results[0]!.fromCache).toBe(true);
    expect(recorder.entries).toHaveLength(1);

    const score = computePhotoScore(
      first.results,
      buildPhotoSetInsights(first.results),
    );

    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(100);
  }, 120_000);

  it('rejeita credencial inválida sem retentar', async () => {
    const bad = new GeminiVisionProvider({ apiKey: 'chave-invalida-xyz', model });

    const validated = validateImage(buildSyntheticRoomPng(), {
      maxSizeBytes: 10 * 1_048_576,
    });

    const error = await bad
      .analyzeImage(toImageInput(validated, { id: 'p0', position: 0 }))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    // Chave errada não melhora com retentativa.
    expect((error as { retryable?: boolean }).retryable).toBe(false);
  }, 60_000);
});
