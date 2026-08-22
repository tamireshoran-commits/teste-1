import { requireUserId } from '@/server/auth';
import { route } from '@/server/http/handler';
import { conversationService } from '@/server/growth/services/ConversationService';
import { workspaceService } from '@/server/growth/services/WorkspaceService';

export function GET(request: Request) {
  return route(async () => {
    const userId = await requireUserId();
    const workspace = await workspaceService.ensureForUser(userId);
    const status = new URL(request.url).searchParams.get('status');

    return {
      conversations: await conversationService.listForWorkspace(
        workspace.id,
        userId,
        { ...(status !== null ? { status } : {}) },
      ),
    };
  });
}
