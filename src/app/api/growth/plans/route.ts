import { z } from 'zod';
import { requireUserId } from '@/server/auth';
import { parseBody, route } from '@/server/http/handler';
import { contentService } from '@/server/growth/services/ContentService';
import { workspaceService } from '@/server/growth/services/WorkspaceService';

const createSchema = z.object({
  title: z.string().trim().min(3).max(160),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  pieceCount: z.number().int().min(1).max(30).default(12),
});

export function POST(request: Request) {
  return route(async () => {
    const userId = await requireUserId();
    const workspace = await workspaceService.ensureForUser(userId);
    const body = await parseBody(request, createSchema);

    const plan = await contentService.createPlan(workspace.id, userId, body);

    return { id: plan.id, status: plan.status };
  }, 202);
}
