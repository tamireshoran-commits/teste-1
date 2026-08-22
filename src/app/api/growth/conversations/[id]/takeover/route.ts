import { requireUserId } from '@/server/auth';
import { route } from '@/server/http/handler';
import { conversationService } from '@/server/growth/services/ConversationService';

/**
 * Humano assume a conversa.
 *
 * A partir daqui o agente não responde mais nesta conversa — quem assumiu
 * assumiu, e duas vozes respondendo a mesma pessoa é pior que nenhuma.
 */
export function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return route(async () => {
    const userId = await requireUserId();
    const { id } = await context.params;

    return conversationService.takeOver(id, userId);
  });
}
