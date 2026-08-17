import { sha256 } from '@/server/core/shared/cache';
import { InvalidInputError } from '@/server/core/shared/errors';
import type { ImageInput } from '@/server/core/types';
import type {
  VisionAnalyzeOptions,
  VisionAnalyzeOutput,
  VisionProvider,
} from './VisionProvider';

/**
 * Provider de visão simulado.
 *
 * Existe por dois motivos concretos:
 * 1. permitir rodar o fluxo inteiro sem `GEMINI_API_KEY` e sem gastar crédito;
 * 2. dar aos testes um provider determinístico — mesma imagem, mesmo resultado.
 *
 * As notas derivam do hash do conteúdo, então imagens diferentes produzem
 * resultados diferentes e estáveis. **Isto não é análise de verdade**: o
 * `provider` retornado é `mock`, e o consumidor precisa rotular como simulado.
 */
export class MockVisionProvider implements VisionProvider {
  readonly name = 'mock';
  readonly model = 'mock-model';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async analyzeImage(
    image: ImageInput,
    _options?: VisionAnalyzeOptions,
  ): Promise<VisionAnalyzeOutput> {
    if (image.data.byteLength === 0) {
      throw new InvalidInputError('Imagem vazia.', 'INVALID_INPUT', {
        photoId: image.id,
      });
    }

    // Determinístico: derivado do conteúdo, não aleatório.
    const seed = sha256(image.sha256);
    const pick = (offset: number, min: number, max: number) =>
      min + (parseInt(seed.slice(offset, offset + 4), 16) % (max - min + 1));

    const visualQuality = pick(0, 45, 95);
    const lighting = pick(4, 40, 95);
    const composition = pick(8, 45, 92);
    const professionalism = pick(12, 35, 90);
    const valuePerception = pick(16, 40, 93);
    const clarity = pick(20, 50, 96);

    const roomTypes = [
      'sala', 'quarto', 'cozinha', 'banheiro', 'area_externa', 'varanda',
    ] as const;
    const roomType = roomTypes[pick(24, 0, roomTypes.length - 1)]!;

    const score = Math.round(
      visualQuality * 0.25 +
        lighting * 0.25 +
        valuePerception * 0.2 +
        composition * 0.15 +
        professionalism * 0.1 +
        clarity * 0.05,
    );

    return {
      result: {
        photoId: image.id,
        roomType,
        visualQuality,
        lighting,
        composition,
        professionalism,
        valuePerception,
        clarity,
        strengths: ['[simulado] Enquadramento mostra bem o ambiente'],
        problems:
          lighting < 60 ? ['[simulado] Iluminação abaixo do ideal'] : [],
        recommendations:
          lighting < 60
            ? ['[simulado] Refotografar com luz natural durante o dia']
            : ['[simulado] Manter o padrão nas demais fotos'],
        score,
      },
      usage: { inputTokens: 0, outputTokens: 0, imageCount: 1 },
    };
  }
}
