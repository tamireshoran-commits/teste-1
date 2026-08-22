import { z } from 'zod';
import type { BrandContext, ContentFormat } from '../types';
import { brandVariables } from './shared';
import { runAgent, type AgentDeps, type AgentResult } from './runAgent';

/**
 * Agente 3 — Criador de Vídeos.
 *
 * Não gera o vídeo: gera o **briefing de produção**. A separação é deliberada
 * — o briefing é barato, revisável e independente de fornecedor; a geração é
 * cara e muda de API a cada seis meses. Com o briefing pronto, trocar de
 * ferramenta de vídeo é trocar um provider.
 */

export const videoBriefSchema = z.object({
  totalDurationSec: z.number().min(5).max(180),
  aspectRatio: z.string().default('9:16'),
  scenes: z
    .array(
      z.object({
        index: z.number().int().min(1),
        durationSec: z.number().min(0.5).max(60),
        visualPrompt: z.string().min(10),
        narration: z.string(),
        onScreenText: z.string().default(''),
        bRoll: z.string().default('nenhum'),
      }),
    )
    .min(1),
  narrationScript: z.string().min(10),
  captions: z
    .array(
      z.object({
        startSec: z.number().min(0),
        endSec: z.number().min(0),
        text: z.string(),
      }),
    )
    .default([]),
  thumbnailPrompt: z.string().default(''),
  hashtags: z.array(z.string()).default([]),
  musicMood: z.string().default(''),
});

export type VideoBriefOutput = z.infer<typeof videoBriefSchema>;

export interface VideoCreatorInput {
  brand: BrandContext;
  format: ContentFormat;
  theme: string;
  hook: string;
  script: string;
  caption: string;
  cta: string;
}

export async function runVideoCreator(
  input: VideoCreatorInput,
  deps: AgentDeps,
): Promise<AgentResult<VideoBriefOutput>> {
  return runAgent({
    ...deps,
    agent: 'VIDEO_CREATOR',
    operation: 'growth:video-brief',
    prompt: 'growth/video-brief',
    schema: videoBriefSchema,
    tier: 'cheap',
    temperature: 0.6,
    maxOutputTokens: 5000,
    variables: {
      ...brandVariables(input.brand),
      format: input.format,
      theme: input.theme,
      hook: input.hook,
      script: input.script,
      caption: input.caption,
      cta: input.cta,
    },
  });
}

/**
 * Confere se a soma das cenas bate com a duração declarada.
 *
 * O modelo erra essa conta com frequência, e uma diferença de 8 segundos
 * significa narração cortada no meio da frase no vídeo final. Tolerância de
 * 15% em vez de exigir igualdade exata — arredondamento de cena é normal.
 */
export function validateSceneDurations(brief: VideoBriefOutput): {
  ok: boolean;
  sumSec: number;
  message?: string;
} {
  const sumSec = brief.scenes.reduce((total, s) => total + s.durationSec, 0);
  const tolerance = Math.max(2, brief.totalDurationSec * 0.15);
  const ok = Math.abs(sumSec - brief.totalDurationSec) <= tolerance;

  return ok
    ? { ok, sumSec }
    : {
        ok,
        sumSec,
        message:
          `A soma das cenas (${sumSec.toFixed(1)}s) não corresponde à duração ` +
          `declarada (${brief.totalDurationSec}s).`,
      };
}
