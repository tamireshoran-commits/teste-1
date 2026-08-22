import { z } from 'zod';
import { requireUserId } from '@/server/auth';
import { parseBody, route } from '@/server/http/handler';
import { dashboardService } from '@/server/growth/services/DashboardService';
import { workspaceService } from '@/server/growth/services/WorkspaceService';

const patchSchema = z.object({
  mode: z.enum(['MANUAL', 'SEMI_AUTOMATIC', 'AUTONOMOUS']).optional(),
  timezone: z.string().min(1).max(60).optional(),
  quietHoursStart: z.number().int().min(0).max(23).optional(),
  quietHoursEnd: z.number().int().min(0).max(23).optional(),
  maxDailyCostUsd: z.number().positive().max(1000).optional(),
  maxMessagesPerContactPerDay: z.number().int().min(1).max(20).optional(),
  maxPublicationsPerDay: z.number().int().min(1).max(25).optional(),
});

export function GET() {
  return route(async () => {
    const userId = await requireUserId();
    const workspace = await workspaceService.ensureForUser(userId);

    return {
      workspace,
      summary: await dashboardService.summary(workspace.id, userId),
    };
  });
}

export function PATCH(request: Request) {
  return route(async () => {
    const userId = await requireUserId();
    const workspace = await workspaceService.ensureForUser(userId);
    const body = await parseBody(request, patchSchema);

    if (body.mode !== undefined) {
      await workspaceService.setMode(workspace.id, userId, body.mode);
    }

    const { mode: _mode, ...settings } = body;

    return workspaceService.updateSettings(workspace.id, userId, settings);
  });
}
