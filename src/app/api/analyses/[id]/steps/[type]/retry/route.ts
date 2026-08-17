import { z } from 'zod';
import { requireUserId } from '@/server/auth';
import { AppError } from '@/server/core/shared/errors';
import { route } from '@/server/http/handler';
import { analysisService } from '@/server/services/AnalysisService';

const stepTypeSchema = z.enum([
  'PRICING',
  'PHOTOS',
  'AIRBNB',
  'BOOKING',
  'RECOMMENDATIONS',
  'REPORT',
]);

/**
 * Reexecuta uma etapa isolada.
 *
 * É o que permite ao usuário recuperar uma falha pontual — um rate limit no
 * meio das fotos, por exemplo — sem reprocessar tudo e pagar de novo pelo que
 * já deu certo.
 */
export function POST(
  _request: Request,
  context: { params: Promise<{ id: string; type: string }> },
) {
  return route(async () => {
    const userId = await requireUserId();
    const { id, type } = await context.params;

    const parsed = stepTypeSchema.safeParse(type.toUpperCase());

    if (!parsed.success) {
      throw new AppError(`Etapa desconhecida: "${type}".`, {
        code: 'VALIDATION_ERROR',
      });
    }

    await analysisService.retryStep(id, userId, parsed.data);

    const analysis = await analysisService.getForUser(id, userId);
    const step = analysis.steps.find((s) => s.type === parsed.data);

    return {
      type: parsed.data,
      status: step?.status ?? 'PENDING',
      message: step?.message ?? null,
      errorMessage: step?.errorMessage ?? null,
      overallScore: analysis.overallScore,
    };
  });
}
