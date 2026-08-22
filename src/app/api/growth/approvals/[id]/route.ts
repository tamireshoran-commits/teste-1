import { z } from 'zod';
import { requireUserId } from '@/server/auth';
import { parseBody, route } from '@/server/http/handler';
import { approvalService } from '@/server/growth/services/ApprovalService';

const decisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  notes: z.string().trim().max(500).optional(),
});

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return route(async () => {
    const userId = await requireUserId();
    const { id } = await context.params;
    const body = await parseBody(request, decisionSchema);

    return approvalService.decide(id, userId, body.decision, body.notes);
  });
}
