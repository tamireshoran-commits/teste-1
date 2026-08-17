import { z } from 'zod';
import { ProviderError } from '@/server/core/shared/errors';
import type { Finding, ImpactLevel } from '@/server/core/types';

/**
 * Contrato da leitura qualitativa do anúncio feita pela IA.
 *
 * O modelo julga o que as regras determinísticas não alcançam: se o título
 * comunica um diferencial, se a descrição responde às dúvidas do hóspede, em
 * que segmento o anúncio se posiciona.
 *
 * A validação é estrita porque essa saída entra no relatório do cliente. Nota
 * fora da faixa satura; campo inesperado é ignorado; resposta fora do contrato
 * derruba só o enriquecimento, não a análise inteira.
 */

const score0to100 = z.coerce
  .number()
  .transform((n) => Math.round(Math.min(100, Math.max(0, n))));

const textList = (max: number) =>
  z.array(z.string().trim().min(1).max(500)).max(max).catch([]).default([]);

const severity = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v): ImpactLevel =>
    v === 'HIGH' || v === 'MEDIUM' || v === 'LOW' ? v : 'MEDIUM',
  );

const problem = z.object({
  code: z.string().trim().min(1).max(60).catch('LLM_FINDING'),
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().min(1).max(1000),
  severity: severity.catch('MEDIUM'),
});

const baseAnalysis = {
  strengths: textList(12),
  weaknesses: textList(12),
  missing_info: textList(15),
  positioning: z.string().trim().max(300).optional(),
  problems: z.array(problem).max(15).catch([]).default([]),
};

export const airbnbAnalysisSchema = z.object({
  scores: z.object({
    content: score0to100,
    amenities: score0to100,
    reputation: score0to100,
    presentation: score0to100,
    competitiveness: score0to100,
  }),
  differentiators: textList(12),
  ...baseAnalysis,
});

export const bookingAnalysisSchema = z.object({
  scores: z.object({
    content: score0to100,
    amenities: score0to100,
    reputation: score0to100,
    policies: score0to100,
    competitiveness: score0to100,
  }),
  recurring_positives: textList(12),
  recurring_negatives: textList(12),
  ...baseAnalysis,
});

export type AirbnbLLMAnalysis = z.infer<typeof airbnbAnalysisSchema>;
export type BookingLLMAnalysis = z.infer<typeof bookingAnalysisSchema>;
export type ListingLLMAnalysis = AirbnbLLMAnalysis | BookingLLMAnalysis;

export function parseListingAnalysis(
  platform: 'AIRBNB' | 'BOOKING',
  raw: unknown,
): ListingLLMAnalysis {
  const schema =
    platform === 'AIRBNB' ? airbnbAnalysisSchema : bookingAnalysisSchema;

  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');

    throw new ProviderError(
      `A análise do modelo não segue o contrato esperado (${issues}).`,
      { retryable: true },
    );
  }

  return parsed.data;
}

/** Converte os problemas relatados pela IA para o tipo do domínio. */
export function toFindings(analysis: ListingLLMAnalysis): Finding[] {
  return analysis.problems.map((p) => ({
    code: p.code,
    title: p.title,
    detail: p.detail,
    severity: p.severity,
    // Marca a origem: o relatório precisa distinguir o que veio de regra
    // determinística do que veio de julgamento de modelo.
    evidence: { source: 'llm' },
  }));
}

export function differentiatorsOf(analysis: ListingLLMAnalysis): string[] {
  return 'differentiators' in analysis ? analysis.differentiators : [];
}

export function reviewThemesOf(analysis: ListingLLMAnalysis): {
  positive: string[];
  negative: string[];
} {
  if ('recurring_positives' in analysis) {
    return {
      positive: analysis.recurring_positives,
      negative: analysis.recurring_negatives,
    };
  }

  return { positive: [], negative: [] };
}
