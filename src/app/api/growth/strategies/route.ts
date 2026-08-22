import { z } from 'zod';
import { requireUserId } from '@/server/auth';
import { parseBody, route } from '@/server/http/handler';
import { strategyService } from '@/server/growth/services/StrategyService';
import { workspaceService } from '@/server/growth/services/WorkspaceService';

const createSchema = z.object({
  niche: z.string().trim().min(3).max(160),
  brief: z.string().trim().min(20).max(4000),
});

export function GET() {
  return route(async () => {
    const userId = await requireUserId();
    const workspace = await workspaceService.ensureForUser(userId);

    return {
      strategies: await strategyService.listForWorkspace(workspace.id, userId),
    };
  });
}

export function POST(request: Request) {
  return route(async () => {
    const userId = await requireUserId();
    const workspace = await workspaceService.ensureForUser(userId);
    const body = await parseBody(request, createSchema);

    const strategy = await strategyService.request(workspace.id, userId, body);

    return { id: strategy.id, status: strategy.status };
  }, 202);
}
