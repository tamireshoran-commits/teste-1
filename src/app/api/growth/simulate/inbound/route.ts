import { z } from 'zod';
import { env } from '@/server/config/env';
import { requireUserId } from '@/server/auth';
import { ValidationError } from '@/server/core/shared/errors';
import { parseBody, route } from '@/server/http/handler';
import { prisma } from '@/server/db/prisma';
import { growthQueue } from '@/server/growth/jobs/queue';
import { workspaceService } from '@/server/growth/services/WorkspaceService';

const simulateSchema = z.object({
  channel: z.enum(['IG_DM', 'IG_COMMENT', 'FB_MESSENGER', 'FB_COMMENT']),
  text: z.string().trim().min(1).max(2000),
  contactExternalId: z.string().trim().min(1).max(80).default('sim-contato-1'),
  contactUsername: z.string().trim().max(80).default('contato.simulado'),
  sourceExternalPostId: z.string().trim().max(120).optional(),
});

/**
 * Simula uma interação recebida.
 *
 * Sem isto, testar o fluxo de vendas de ponta a ponta exigiria o App Review da
 * Meta aprovado — semanas de espera antes de saber se a qualificação e a
 * resposta funcionam.
 *
 * Só funciona com `SOCIAL_PROVIDER=MOCK`: injetar uma pessoa fictícia no CRM
 * de um workspace que já opera de verdade contaminaria o funil e as métricas
 * que alimentam o módulo de aprendizado.
 */
export function POST(request: Request) {
  return route(async () => {
    const userId = await requireUserId();

    if (env.SOCIAL_PROVIDER !== 'MOCK') {
      throw new ValidationError(
        'A simulação de eventos só é permitida com SOCIAL_PROVIDER=MOCK.',
      );
    }

    const workspace = await workspaceService.ensureForUser(userId);
    const body = await parseBody(request, simulateSchema);

    const platform = body.channel.startsWith('IG') ? 'INSTAGRAM' : 'FACEBOOK';

    const account = await prisma.socialAccount.findFirst({
      where: { workspaceId: workspace.id, platform },
    });

    if (!account) {
      throw new ValidationError(
        `Conecte uma conta ${platform} antes de simular uma interação.`,
      );
    }

    const externalId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const event = await prisma.webhookEvent.create({
      data: {
        platform,
        externalId,
        topic: 'simulacao',
        signatureValid: false,
        status: 'RECEIVED',
        payload: {
          normalized: {
            platform,
            channel: body.channel,
            externalId,
            recipientExternalId: account.externalId,
            contactExternalId: body.contactExternalId,
            contactUsername: body.contactUsername,
            text: body.text,
            occurredAt: new Date().toISOString(),
            sourceExternalPostId: body.sourceExternalPostId ?? null,
            topic: 'simulacao',
          },
          socialAccountId: account.id,
          workspaceId: workspace.id,
          simulado: true,
        },
      },
    });

    await growthQueue.enqueue(
      'inbound.process',
      { webhookEventId: event.id },
      {
        workspaceId: workspace.id,
        dedupeKey: `inbound.process:${externalId}`,
      },
    );

    return { webhookEventId: event.id, externalId };
  }, 202);
}
