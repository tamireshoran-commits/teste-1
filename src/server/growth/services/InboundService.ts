import { NotFoundError } from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';
import { prisma } from '@/server/db/prisma';
import { growthQueue } from '../jobs/queue';
import type { ConversationChannel, SocialPlatform } from '../types';
import { conversationService } from './ConversationService';
import { leadService } from './LeadService';

const log = logger.child('growth-inbound');

interface StoredNormalizedEvent {
  platform: SocialPlatform;
  channel: ConversationChannel;
  externalId: string;
  contactExternalId: string;
  contactUsername: string | null;
  text: string;
  occurredAt: string;
  sourceExternalPostId: string | null;
}

/**
 * Processamento do evento recebido: ingestão → qualificação → resposta.
 *
 * A resposta sai como job separado de propósito. Se o agente de vendas falhar
 * (modelo fora do ar, guardrail, limite), a mensagem recebida **já está
 * gravada** e o lead **já está qualificado** — só a resposta é retentada.
 * Um job único faria a retentativa reprocessar tudo e requalificar o mesmo
 * lead várias vezes.
 */
export class InboundService {
  async process(webhookEventId: string, jobId?: string) {
    const event = await prisma.webhookEvent.findUnique({
      where: { id: webhookEventId },
    });

    if (!event) throw new NotFoundError('Evento de webhook', webhookEventId);

    if (event.status === 'PROCESSED') {
      return { skipped: true as const, reason: 'já processado' };
    }

    const payload = event.payload as {
      normalized?: StoredNormalizedEvent;
      workspaceId?: string | null;
      socialAccountId?: string | null;
    } | null;

    const normalized = payload?.normalized;
    const workspaceId = payload?.workspaceId ?? null;

    if (normalized === undefined || workspaceId === null) {
      await prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: {
          status: 'IGNORED',
          errorMessage: 'Evento sem dados normalizados ou sem workspace.',
          processedAt: new Date(),
        },
      });

      return { skipped: true as const, reason: 'evento incompleto' };
    }

    const ingested = await conversationService.ingestInbound({
      workspaceId,
      platform: normalized.platform,
      channel: normalized.channel,
      contactExternalId: normalized.contactExternalId,
      contactUsername: normalized.contactUsername,
      text: normalized.text,
      externalMessageId: normalized.externalId,
      occurredAt: new Date(normalized.occurredAt),
      socialAccountId: payload?.socialAccountId ?? null,
      sourceExternalPostId: normalized.sourceExternalPostId,
    });

    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });

    if (ingested.duplicate) {
      return { skipped: true as const, reason: 'mensagem duplicada' };
    }

    await leadService.qualify(ingested.conversationId, normalized.text, jobId);

    await growthQueue.enqueue(
      'conversation.respond',
      { workspaceId, conversationId: ingested.conversationId },
      {
        workspaceId,
        dedupeKey: `conversation.respond:${normalized.externalId}`,
      },
    );

    log.info('evento processado', {
      webhookEventId,
      conversationId: ingested.conversationId,
      channel: normalized.channel,
    });

    return {
      conversationId: ingested.conversationId,
      contactId: ingested.contactId,
      skipped: false as const,
    };
  }
}

export const inboundService = new InboundService();
