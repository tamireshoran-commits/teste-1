import { z } from 'zod';
import { requireUserId } from '@/server/auth';
import { parseBody, route } from '@/server/http/handler';
import { prisma } from '@/server/db/prisma';
import { publishingService } from '@/server/growth/services/PublishingService';
import { workspaceService } from '@/server/growth/services/WorkspaceService';

const connectSchema = z.object({
  platform: z.enum(['INSTAGRAM', 'FACEBOOK']),
  externalId: z.string().trim().min(1).max(80),
  username: z.string().trim().max(80).optional(),
  pageId: z.string().trim().max(80).optional(),
  /**
   * NOME da variável de ambiente que guarda o token — nunca o token. Impedir
   * isso na validação evita o erro de colar o token no formulário e gravá-lo
   * em texto claro no banco.
   */
  tokenRef: z
    .string()
    .trim()
    .regex(
      /^[A-Z][A-Z0-9_]{2,63}$/,
      'Informe o NOME da variável de ambiente (ex.: META_TOKEN_LOJA), não o token.',
    )
    .optional(),
});

export function GET() {
  return route(async () => {
    const userId = await requireUserId();
    const workspace = await workspaceService.ensureForUser(userId);

    return {
      accounts: await prisma.socialAccount.findMany({
        where: { workspaceId: workspace.id },
        orderBy: { createdAt: 'asc' },
      }),
    };
  });
}

export function POST(request: Request) {
  return route(async () => {
    const userId = await requireUserId();
    const workspace = await workspaceService.ensureForUser(userId);
    const body = await parseBody(request, connectSchema);

    return publishingService.connectAccount(workspace.id, userId, body);
  }, 201);
}
