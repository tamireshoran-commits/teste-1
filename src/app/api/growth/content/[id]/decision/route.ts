import { z } from 'zod';
import { requireUserId } from '@/server/auth';
import { parseBody, route } from '@/server/http/handler';
import { contentService } from '@/server/growth/services/ContentService';

const decisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Aprovação de conteúdo pelo humano.
 *
 * Aprovar dispara a geração de mídia e, dela, a publicação — o caminho é o
 * mesmo do modo autônomo, só que com o clique no meio.
 */
export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return route(async () => {
    const userId = await requireUserId();
    const { id } = await context.params;
    const body = await parseBody(request, decisionSchema);

    return body.decision === 'APPROVE'
      ? contentService.approvePiece(id, userId)
      : contentService.rejectPiece(
          id,
          userId,
          body.reason ?? 'Sem motivo informado.',
        );
  });
}
