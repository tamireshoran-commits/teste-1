import { logger } from '@/server/core/shared/logger';
import { prisma } from '@/server/db/prisma';
import type {
  ConversationChannel,
  ConversationTurn,
  SocialPlatform,
} from '../types';
import { workspaceService } from './WorkspaceService';

const log = logger.child('growth-conversation');

/**
 * Ingestão de interações e memória de conversa.
 *
 * A idempotência mora aqui: `Message` tem índice único em
 * `(workspaceId, externalId)`, então o mesmo comentário entregue duas vezes
 * pelo webhook vira uma mensagem só. Sem isso, a pessoa recebe a resposta em
 * duplicidade — o erro mais visível que um sistema desses pode cometer.
 */
export class ConversationService {
  async ingestInbound(input: {
    workspaceId: string;
    platform: SocialPlatform;
    channel: ConversationChannel;
    contactExternalId: string;
    contactUsername: string | null;
    text: string;
    externalMessageId: string;
    occurredAt: Date;
    socialAccountId: string | null;
    /** Id do post na plataforma, quando a interação veio de um conteúdo. */
    sourceExternalPostId: string | null;
  }) {
    const contact = await prisma.contact.upsert({
      where: {
        workspaceId_platform_externalId: {
          workspaceId: input.workspaceId,
          platform: input.platform,
          externalId: input.contactExternalId,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        platform: input.platform,
        externalId: input.contactExternalId,
        username: input.contactUsername,
        socialAccountId: input.socialAccountId,
        firstSeenAt: input.occurredAt,
        lastInteractionAt: input.occurredAt,
      },
      update: {
        lastInteractionAt: input.occurredAt,
        ...(input.contactUsername !== null
          ? { username: input.contactUsername }
          : {}),
      },
    });

    const existingMessage = await prisma.message.findUnique({
      where: {
        workspaceId_externalId: {
          workspaceId: input.workspaceId,
          externalId: input.externalMessageId,
        },
      },
      select: { id: true, conversationId: true },
    });

    if (existingMessage) {
      log.debug('mensagem já processada', {
        externalId: input.externalMessageId,
      });

      return {
        contactId: contact.id,
        conversationId: existingMessage.conversationId,
        messageId: existingMessage.id,
        duplicate: true as const,
      };
    }

    const source = await this.resolveSource(
      input.workspaceId,
      input.sourceExternalPostId,
    );

    const conversation =
      (await prisma.conversation.findFirst({
        where: {
          workspaceId: input.workspaceId,
          contactId: contact.id,
          channel: input.channel,
          status: { not: 'CLOSED' },
        },
        orderBy: { updatedAt: 'desc' },
      })) ??
      (await prisma.conversation.create({
        data: {
          workspaceId: input.workspaceId,
          contactId: contact.id,
          channel: input.channel,
          status: 'OPEN',
          sourcePublicationId: source?.publicationId ?? null,
          sourceContentPieceId: source?.contentPieceId ?? null,
        },
      }));

    const message = await prisma.message.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: conversation.id,
        direction: 'INBOUND',
        status: 'RECEIVED',
        text: input.text,
        externalId: input.externalMessageId,
        receivedAt: input.occurredAt,
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastInboundAt: input.occurredAt,
        // Quem já estava com humano continua com humano: o agente não retoma
        // uma conversa que uma pessoa assumiu.
        status:
          conversation.status === 'HUMAN_HANDLED' ||
          conversation.status === 'WAITING_HUMAN'
            ? conversation.status
            : 'OPEN',
        ...(conversation.sourceContentPieceId === null && source
          ? {
              sourceContentPieceId: source.contentPieceId,
              sourcePublicationId: source.publicationId,
            }
          : {}),
      },
    });

    return {
      contactId: contact.id,
      conversationId: conversation.id,
      messageId: message.id,
      duplicate: false as const,
    };
  }

  /** Histórico no formato que os agentes consomem. */
  async history(conversationId: string, limit = 30): Promise<ConversationTurn[]> {
    const messages = await prisma.message.findMany({
      where: {
        conversationId,
        status: { in: ['RECEIVED', 'SENT'] },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    return messages.map((message) => ({
      direction: message.direction,
      text: message.text,
      at: message.sentAt ?? message.receivedAt ?? message.createdAt,
    }));
  }

  async countOutboundToday(
    workspaceId: string,
    contactId: string,
  ): Promise<number> {
    return prisma.message.count({
      where: {
        workspaceId,
        direction: 'OUTBOUND',
        status: 'SENT',
        sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        conversation: { contactId },
      },
    });
  }

  async hasPendingOutbound(conversationId: string): Promise<boolean> {
    const pending = await prisma.message.findFirst({
      where: {
        conversationId,
        direction: 'OUTBOUND',
        status: { in: ['PENDING_APPROVAL', 'QUEUED'] },
      },
      select: { id: true },
    });

    return pending !== null;
  }

  async assignToHuman(conversationId: string, reason: string) {
    return prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'WAITING_HUMAN', nextAction: reason },
    });
  }

  async takeOver(conversationId: string, userId: string) {
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });

    await workspaceService.requireAccess(conversation.workspaceId, userId);

    return prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'HUMAN_HANDLED', assignedToId: userId },
    });
  }

  async optOut(contactId: string) {
    await prisma.contact.update({
      where: { id: contactId },
      data: { optOut: true, optOutAt: new Date() },
    });

    await prisma.followUpTask.updateMany({
      where: { lead: { contactId }, status: 'PENDING' },
      data: { status: 'CANCELLED', cancelledReason: 'Contato pediu para parar.' },
    });
  }

  async listForWorkspace(
    workspaceId: string,
    userId: string,
    filter: { status?: string } = {},
  ) {
    await workspaceService.requireAccess(workspaceId, userId);

    return prisma.conversation.findMany({
      where: {
        workspaceId,
        ...(filter.status !== undefined
          ? { status: filter.status as never }
          : {}),
      },
      include: {
        contact: true,
        leads: { include: { product: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  async getForUser(conversationId: string, userId: string) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        contact: true,
        leads: { include: { product: true, deals: true } },
        messages: { orderBy: { createdAt: 'asc' } },
        sourceContentPiece: { select: { id: true, theme: true } },
      },
    });

    if (!conversation) return null;

    await workspaceService.requireAccess(conversation.workspaceId, userId);

    return conversation;
  }

  /** Liga a interação ao conteúdo que a originou — base do item 16. */
  private async resolveSource(
    workspaceId: string,
    externalPostId: string | null,
  ): Promise<{ publicationId: string; contentPieceId: string } | null> {
    if (externalPostId === null) return null;

    const publication = await prisma.publication.findFirst({
      where: { workspaceId, externalPostId },
      select: { id: true, contentPieceId: true },
    });

    return publication
      ? {
          publicationId: publication.id,
          contentPieceId: publication.contentPieceId,
        }
      : null;
  }
}

export const conversationService = new ConversationService();
