import { requireUserId } from '@/server/auth';
import { route } from '@/server/http/handler';
import { approvalService } from '@/server/growth/services/ApprovalService';
import { workspaceService } from '@/server/growth/services/WorkspaceService';

export function GET() {
  return route(async () => {
    const userId = await requireUserId();
    const workspace = await workspaceService.ensureForUser(userId);

    return {
      approvals: await approvalService.listPending(workspace.id, userId),
    };
  });
}
