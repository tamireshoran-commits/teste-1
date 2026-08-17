import { z } from 'zod';
import { ProviderError } from '@/server/core/shared/errors';
import type { PhotoAnalysisResult } from '@/server/core/types';

/**
 * Contrato da resposta de visão.
 *
 * Modelos erram formato: devolvem cercas de código, texto antes do JSON, nota
 * como string, campo faltando. Validar aqui garante que nada malformado chegue
 * ao banco ou ao score — e a falha é atribuída a UMA foto, sem derrubar o lote.
 */

const ROOM_TYPES = [
  'sala', 'quarto', 'cozinha', 'banheiro', 'area_externa', 'varanda',
  'piscina', 'fachada', 'vista', 'area_comum', 'detalhe', 'outro',
] as const;

/** Nota 0-100 tolerante: aceita string numérica e satura em vez de rejeitar. */
const score0to100 = z.coerce
  .number()
  .transform((n) => Math.round(Math.min(100, Math.max(0, n))));

const stringList = z
  .array(z.string().trim().min(1))
  .max(10)
  .catch([])
  .default([]);

export const photoResponseSchema = z.object({
  room_type: z
    .string()
    .trim()
    .toLowerCase()
    // Ambiente desconhecido vira "outro" em vez de invalidar a análise inteira.
    .transform((v) => ((ROOM_TYPES as readonly string[]).includes(v) ? v : 'outro')),
  visual_quality: score0to100,
  lighting: score0to100,
  composition: score0to100,
  professionalism: score0to100,
  value_perception: score0to100,
  clarity: score0to100,
  strengths: stringList,
  problems: stringList,
  recommendations: stringList,
  score: score0to100,
});

export type PhotoResponse = z.infer<typeof photoResponseSchema>;

/**
 * Extrai o objeto JSON de uma resposta textual.
 *
 * Mesmo pedindo JSON puro, modelos às vezes envolvem em ```json ... ``` ou
 * escrevem uma frase antes. Recortamos do primeiro `{` até o último `}`.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new ProviderError('A resposta do modelo não contém um objeto JSON.', {
      retryable: true,
      cause: new Error(withoutFence.slice(0, 200)),
    });
  }

  const candidate = withoutFence.slice(start, end + 1);

  try {
    return JSON.parse(candidate);
  } catch (cause) {
    throw new ProviderError('A resposta do modelo não é um JSON válido.', {
      // Vale retentar: a próxima geração pode sair bem formada.
      retryable: true,
      cause,
    });
  }
}

/** Valida o JSON e converte para o DTO do domínio. */
export function parsePhotoResponse(
  raw: unknown,
  photoId: string,
): Omit<PhotoAnalysisResult, 'provider' | 'model' | 'fromCache'> {
  const parsed = photoResponseSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');

    throw new ProviderError(
      `A resposta do modelo não segue o contrato esperado (${issues}).`,
      { retryable: true },
    );
  }

  const data = parsed.data;

  return {
    photoId,
    roomType: data.room_type,
    visualQuality: data.visual_quality,
    lighting: data.lighting,
    composition: data.composition,
    professionalism: data.professionalism,
    valuePerception: data.value_perception,
    clarity: data.clarity,
    strengths: data.strengths,
    problems: data.problems,
    recommendations: data.recommendations,
    score: data.score,
  };
}
