import { z } from 'zod';
import { runAgent, type AgentDeps, type AgentResult } from './runAgent';

/**
 * Módulo de aprendizado — leitura dos padrões.
 *
 * O cálculo dos agregados é determinístico e vive em
 * `services/LearningService`; o modelo só interpreta e escreve a recomendação.
 * A divisão é proposital: número calculado por LLM é número em que não se pode
 * confiar, e "conteúdos sobre X geram mais leads" precisa vir de uma média de
 * verdade.
 */

export const learningInsightsSchema = z.object({
  insights: z
    .array(
      z.object({
        dimension: z.enum([
          'THEME',
          'HOOK',
          'CTA',
          'FORMAT',
          'AUDIENCE',
          'FUNNEL_STAGE',
          'OBJECTION',
        ]),
        subject: z.string(),
        metric: z.string(),
        value: z.number(),
        sampleSize: z.number().int().min(0),
        confidence: z.number().min(0).max(1),
        statement: z.string(),
        recommendation: z.string(),
      }),
    )
    .default([]),
});

export type LearningInsightsOutput = z.infer<typeof learningInsightsSchema>;

export interface LearningAnalystInput {
  brandName: string;
  language: string;
  periodStart: Date;
  periodEnd: Date;
  /** Desempenho por publicação, já calculado. */
  performance: unknown;
  /** Agregados por dimensão, já calculados. */
  aggregates: unknown;
}

export async function runLearningAnalyst(
  input: LearningAnalystInput,
  deps: AgentDeps,
): Promise<AgentResult<LearningInsightsOutput>> {
  return runAgent({
    ...deps,
    agent: 'LEARNING_ANALYST',
    operation: 'growth:learning-insights',
    prompt: 'growth/learning-insights',
    schema: learningInsightsSchema,
    tier: 'smart',
    temperature: 0.3,
    maxOutputTokens: 3000,
    variables: {
      brandName: input.brandName,
      language: input.language,
      periodStart: input.periodStart.toISOString().slice(0, 10),
      periodEnd: input.periodEnd.toISOString().slice(0, 10),
      performance: JSON.stringify(input.performance, null, 2),
      aggregates: JSON.stringify(input.aggregates, null, 2),
    },
  });
}
