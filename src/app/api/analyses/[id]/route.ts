import { requireUserId } from '@/server/auth';
import { route } from '@/server/http/handler';
import { analysisService } from '@/server/services/AnalysisService';

/** Estado da análise, usado pelo polling de progresso no dashboard. */
export function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return route(async () => {
    const userId = await requireUserId();
    const { id } = await context.params;

    const analysis = await analysisService.getForUser(id, userId);

    return {
      id: analysis.id,
      status: analysis.status,
      overallScore: analysis.overallScore,
      scores: {
        airbnb: analysis.airbnbScore,
        booking: analysis.bookingScore,
        pricing: analysis.pricingScore,
        photos: analysis.photoScore,
        content: analysis.contentScore,
        reputation: analysis.reputationScore,
      },
      steps: analysis.steps.map((s) => ({
        type: s.type,
        status: s.status,
        message: s.message,
        progressDone: s.progressDone,
        progressTotal: s.progressTotal,
        errorMessage: s.errorMessage,
        attempts: s.attempts,
      })),
      estimatedCostUsd: analysis.estimatedCostUsd,
    };
  });
}
