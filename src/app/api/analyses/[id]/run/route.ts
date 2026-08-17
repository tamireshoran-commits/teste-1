import { requireUserId } from '@/server/auth';
import { route } from '@/server/http/handler';
import { analysisService } from '@/server/services/AnalysisService';

/**
 * Executa o pipeline.
 *
 * A execução é síncrona: no MVP, uma análise leva segundos e a interface
 * acompanha o progresso consultando o estado. Quando o volume justificar,
 * isto vira uma fila — o modelo de `AnalysisStep` já suporta.
 */
export function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return route(async () => {
    const userId = await requireUserId();
    const { id } = await context.params;

    await analysisService.run(id, userId);

    const analysis = await analysisService.getForUser(id, userId);

    return {
      status: analysis.status,
      overallScore: analysis.overallScore,
      steps: analysis.steps.map((s) => ({
        type: s.type,
        status: s.status,
        message: s.message,
      })),
    };
  });
}
