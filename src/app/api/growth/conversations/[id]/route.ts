import { requireUserId } from '@/server/auth';
import { route } from '@/server/http/handler';
import { NotFoundError } from '@/server/core/shared/errors';
import { conversationService } from '@/server/growth/services/ConversationService';

export function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return route(async () => {
    const userId = await requireUserId();
    const { id } = await context.params;

    const conversation = await conversationService.getForUser(id, userId);

    if (!conversation) throw new NotFoundError('Conversa', id);

    return conversation;
  });
}
