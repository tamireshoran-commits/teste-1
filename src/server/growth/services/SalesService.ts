import { env } from '@/server/config/env';
import { NotFoundError, ValidationError } from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';
import { prisma } from '@/server/db/prisma';
import { resolveCheckoutUrl, runSalesRep } from '../agents/salesRep';
import { growthQueue } from '../jobs/queue';
import { decideApproval } from '../policy/approvalPolicy';
import {
  evaluateCommentReply,
  evaluateOutboundMessage,
  isDirectMessageChannel,
  isOptOutRequest,
  type MessagingDecision,
} from '../policy/messagingPolicy';
import { getSocialMessenger } from '../providers/registry';
import type { SocialAccountRef } from '../providers/social/SocialProvider';
import { resolveAccessToken } from '../providers/social/tokens';
import type { GrowthAction } from '../types';
import { approvalService } from './ApprovalService';
import { audit } from './audit';
import { conversationService } from './ConversationService';
import { followUpService } from './FollowUpService';
import { agentDeps, loadWorkspaceContext } from './context';
import { leadService } from './LeadService';

const log = logger.child('growth-sales');

/**
 * Agente 6 na camada de aplicação: a conversa que vira venda.
 *
 * A ordem das verificações é a parte que importa:
 *
 * 1. pedido de descadastro — antes de qualquer geração;
 * 2. política de plataforma (janela, limites, silêncio) — antes de gastar
 *    token com uma mensagem que não poderia sair;
 * 3. geração pelo modelo;
 * 4. guardrail determinístico sobre o texto gerado;
 * 5. política de aprovação — humano no meio, se o modo pedir;
 * 6. envio.
 *
 * Inverter 2 e 3 custaria dinheiro à toa. Inverter 4 e 6 custaria a marca.
 */
export class SalesService {
  async respond(conversationId: string, jobId?: string) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { contact: true, workspace: true },
    });

    if (!conversation) throw new NotFoundError('Conversa', conversationId);

    if (conversation.status === 'HUMAN_HANDLED') {
      return { skipped: true as const, reason: 'conversa assumida por humano' };
    }

    const context = await loadWorkspaceContext(conversation.workspaceId);
    const history = await conversationService.history(conversationId);

    const lastInbound = [...history]
      .reverse()
      .find((turn) => turn.direction === 'INBOUND');

    if (lastInbound === undefined) {
      return { skipped: true as const, reason: 'nada a responder' };
    }

    // Pedido de parada é atendido na hora, sem passar pelo modelo: a resposta
    // certa a "para de me mandar mensagem" é parar, não argumentar.
    if (isOptOutRequest(lastInbound.text)) {
      await conversationService.optOut(conversation.contactId);

      await prisma.conversation.update({
        where: { id: conversationId },
        data: { status: 'CLOSED', nextAction: 'Contato pediu para parar.' },
      });

      await audit({
        workspaceId: conversation.workspaceId,
        actorType: 'SYSTEM',
        actor: 'messaging-policy',
        action: 'contact.opt_out',
        entityType: 'Contact',
        entityId: conversation.contactId,
        mode: context.settings.mode,
      });

      return { skipped: true as const, reason: 'opt-out' };
    }

    const decision = await this.evaluatePolicy(conversation, context);

    if (!decision.allowed) {
      return this.handleBlocked(conversationId, decision, {
        workspaceId: conversation.workspaceId,
        mode: context.settings.mode,
      });
    }

    const lead = await prisma.lead.findUnique({
      where: { contactId: conversation.contactId },
    });

    const { data } = await runSalesRep(
      {
        brand: context.brand,
        channel: conversation.channel,
        message: lastInbound.text,
        history,
        products: context.products,
        knownObjections: (context.strategy?.objections ?? []).map(
          (item) => `${item.objection} → ${item.response}`,
        ),
        leadSummary:
          lead !== null ? leadService.summarize(lead) : 'lead ainda não qualificado',
      },
      agentDeps(conversation.workspaceId, {
        ...(jobId !== undefined ? { jobId } : {}),
      }),
    );

    // Guardrail bloqueou ou o agente pediu ajuda: a mensagem fica como
    // rascunho para um humano revisar, e nada sai automaticamente.
    if (!data.safeToSend || data.reply.handoffToHuman) {
      const reason = data.reply.handoffToHuman
        ? (data.reply.handoffReason ?? 'O agente pediu atendimento humano.')
        : `Guardrail: ${data.violations.map((v) => v.message).join(' ')}`;

      const draft = await prisma.message.create({
        data: {
          workspaceId: conversation.workspaceId,
          conversationId,
          direction: 'OUTBOUND',
          status: 'DRAFT',
          text: data.reply.message,
          agent: 'SALES_REP',
          blockedReason: reason,
          meta: { violations: data.violations },
        },
      });

      await conversationService.assignToHuman(conversationId, reason);

      log.warn('resposta retida para revisão humana', {
        conversationId,
        reason,
      });

      return { draftId: draft.id, handoff: true as const, reason };
    }

    const checkout = data.reply.shouldSendCheckout
      ? resolveCheckoutUrl(data.reply.productId, context.products)
      : null;

    const text =
      checkout !== null && !data.reply.message.includes(checkout.url)
        ? `${data.reply.message}\n\n${checkout.url}`
        : data.reply.message;

    const action: GrowthAction =
      checkout !== null
        ? 'CHECKOUT_LINK_SEND'
        : isDirectMessageChannel(conversation.channel)
          ? 'DM_SEND'
          : 'COMMENT_REPLY';

    const approval = decideApproval(action, context.settings.mode);

    const message = await prisma.message.create({
      data: {
        workspaceId: conversation.workspaceId,
        conversationId,
        direction: 'OUTBOUND',
        status: approval.requiresApproval ? 'PENDING_APPROVAL' : 'QUEUED',
        text,
        agent: 'SALES_REP',
        meta: {
          stage: data.reply.stage,
          objectionsAddressed: data.reply.objectionsAddressed,
          checkoutUrl: checkout?.url ?? null,
        },
      },
    });

    if (approval.requiresApproval) {
      await approvalService.request({
        workspaceId: conversation.workspaceId,
        actionType: action,
        entityType: 'Message',
        entityId: message.id,
        title: `Responder ${conversation.contact.username ?? 'contato'} (${conversation.channel})`,
        payload: {
          text,
          stage: data.reply.stage,
          checkoutUrl: checkout?.url ?? null,
        },
        requestedByAgent: 'SALES_REP',
      });
    } else {
      await growthQueue.enqueue(
        'message.send',
        { workspaceId: conversation.workspaceId, messageId: message.id },
        {
          workspaceId: conversation.workspaceId,
          dedupeKey: `message.send:${message.id}`,
        },
      );
    }

    if (checkout !== null && lead !== null) {
      await prisma.deal.updateMany({
        where: { leadId: lead.id, status: 'OPEN' },
        data: { stage: 'CHECKOUT_SENT', checkoutUrl: checkout.url },
      });
    }

    if (data.reply.followUpReason !== null && lead !== null) {
      await followUpService.schedule({
        workspaceId: conversation.workspaceId,
        leadId: lead.id,
        conversationId,
        reason: data.reply.followUpReason,
      });
    }

    return {
      messageId: message.id,
      requiresApproval: approval.requiresApproval,
      stage: data.reply.stage,
    };
  }

  /** Executado pelo worker: entrega de fato a mensagem. */
  async send(messageId: string) {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: { include: { contact: true, workspace: true } },
      },
    });

    if (!message) throw new NotFoundError('Mensagem', messageId);

    if (message.status === 'SENT') return { alreadySent: true as const };

    if (message.status !== 'QUEUED') {
      throw new ValidationError(
        `Mensagem no status ${message.status} não pode ser enviada.`,
      );
    }

    const conversation = message.conversation;
    const context = await loadWorkspaceContext(conversation.workspaceId);

    // Reavaliação obrigatória: entre a aprovação humana e este momento pode
    // ter passado meia hora — e a janela de 24h pode ter fechado nesse meio.
    const decision = await this.evaluatePolicy(conversation, context, {
      ignorePendingOutbound: true,
    });

    if (!decision.allowed) {
      await prisma.message.update({
        where: { id: messageId },
        data: { status: 'BLOCKED', blockedReason: decision.reason },
      });

      if (decision.retryAt !== undefined) {
        await prisma.message.update({
          where: { id: messageId },
          data: { status: 'QUEUED', blockedReason: decision.reason },
        });

        await growthQueue.enqueue(
          'message.send',
          { workspaceId: conversation.workspaceId, messageId },
          {
            workspaceId: conversation.workspaceId,
            runAt: decision.retryAt,
            dedupeKey: `message.send:${messageId}:${decision.retryAt.toISOString()}`,
          },
        );

        return { deferred: true as const, reason: decision.reason };
      }

      await conversationService.assignToHuman(conversation.id, decision.reason);

      return { blocked: true as const, reason: decision.reason };
    }

    const account = await this.resolveAccount(
      conversation.workspaceId,
      conversation.contact.platform,
      conversation.contact.socialAccountId,
    );

    const messenger = getSocialMessenger();
    const isComment =
      conversation.channel === 'IG_COMMENT' ||
      conversation.channel === 'FB_COMMENT';

    const inboundExternalId = await this.lastInboundExternalId(conversation.id);

    const result = isComment
      ? await messenger.replyToComment({
          account,
          commentExternalId: inboundExternalId ?? conversation.contact.externalId,
          text: message.text,
        })
      : await messenger.sendDirectMessage({
          account,
          recipientExternalId: conversation.contact.externalId,
          text: message.text,
        });

    const sentAt = new Date();

    const sent = await prisma.message.update({
      where: { id: messageId },
      data: {
        status: 'SENT',
        sentAt,
        externalId: result.externalMessageId,
        blockedReason: null,
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastOutboundAt: sentAt,
        status: conversation.status === 'OPEN' ? 'WAITING_CUSTOMER' : conversation.status,
      },
    });

    await audit({
      workspaceId: conversation.workspaceId,
      actorType: 'AGENT',
      actor: 'SALES_REP',
      action: isComment ? 'comment.replied' : 'dm.sent',
      entityType: 'Message',
      entityId: messageId,
      mode: context.settings.mode,
      metadata: { isMock: result.isMock, channel: conversation.channel },
    });

    return { sent, isMock: result.isMock };
  }

  private async evaluatePolicy(
    conversation: {
      id: string;
      workspaceId: string;
      contactId: string;
      channel: 'IG_DM' | 'IG_COMMENT' | 'FB_MESSENGER' | 'FB_COMMENT';
      status: string;
      lastInboundAt: Date | null;
      contact: { optOut: boolean };
    },
    context: Awaited<ReturnType<typeof loadWorkspaceContext>>,
    options: { ignorePendingOutbound?: boolean } = {},
  ): Promise<MessagingDecision> {
    const hasPendingOutbound =
      options.ignorePendingOutbound === true
        ? false
        : await conversationService.hasPendingOutbound(conversation.id);

    const quietHours = {
      start: context.settings.quietHoursStart,
      end: context.settings.quietHoursEnd,
    };

    if (!isDirectMessageChannel(conversation.channel)) {
      return evaluateCommentReply({
        now: new Date(),
        contactOptOut: conversation.contact.optOut,
        quietHours,
        timezone: context.settings.timezone,
        hasPendingOutbound,
      });
    }

    return evaluateOutboundMessage({
      now: new Date(),
      channel: conversation.channel,
      lastInboundAt: conversation.lastInboundAt,
      contactOptOut: conversation.contact.optOut,
      conversationClosed: conversation.status === 'CLOSED',
      messagesSentToday: await conversationService.countOutboundToday(
        conversation.workspaceId,
        conversation.contactId,
      ),
      maxMessagesPerContactPerDay: context.settings.maxMessagesPerContactPerDay,
      quietHours,
      timezone: context.settings.timezone,
      windowHours: env.GROWTH_MESSAGE_WINDOW_HOURS,
      hasPendingOutbound,
    });
  }

  private async handleBlocked(
    conversationId: string,
    decision: Extract<MessagingDecision, { allowed: false }>,
    meta: { workspaceId: string; mode: 'MANUAL' | 'SEMI_AUTOMATIC' | 'AUTONOMOUS' },
  ) {
    if (decision.retryAt !== undefined) {
      await growthQueue.enqueue(
        'conversation.respond',
        { workspaceId: meta.workspaceId, conversationId },
        {
          workspaceId: meta.workspaceId,
          runAt: decision.retryAt,
          dedupeKey: `conversation.respond:${conversationId}:${decision.retryAt.toISOString()}`,
        },
      );

      return { deferred: true as const, reason: decision.reason };
    }

    if (decision.code === 'OUTSIDE_WINDOW' || decision.code === 'NO_INBOUND') {
      await conversationService.assignToHuman(conversationId, decision.reason);
    }

    await audit({
      workspaceId: meta.workspaceId,
      actorType: 'SYSTEM',
      actor: 'messaging-policy',
      action: 'message.blocked',
      entityType: 'Conversation',
      entityId: conversationId,
      mode: meta.mode,
      metadata: { code: decision.code, reason: decision.reason },
    });

    return { blocked: true as const, reason: decision.reason };
  }

  private async resolveAccount(
    workspaceId: string,
    platform: 'INSTAGRAM' | 'FACEBOOK',
    socialAccountId: string | null,
  ): Promise<SocialAccountRef> {
    const account =
      socialAccountId !== null
        ? await prisma.socialAccount.findUnique({ where: { id: socialAccountId } })
        : await prisma.socialAccount.findFirst({
            where: { workspaceId, platform, status: { in: ['CONNECTED', 'MOCK'] } },
          });

    if (!account) {
      throw new ValidationError(
        `Nenhuma conta ${platform} conectada neste workspace para enviar a mensagem.`,
      );
    }

    return {
      platform: account.platform,
      externalId: account.externalId,
      pageId: account.pageId,
      accessToken: resolveAccessToken(account.tokenRef),
    };
  }

  /** Responder comentário exige o id do comentário, não o do autor. */
  private async lastInboundExternalId(
    conversationId: string,
  ): Promise<string | null> {
    const message = await prisma.message.findFirst({
      where: { conversationId, direction: 'INBOUND' },
      orderBy: { createdAt: 'desc' },
      select: { externalId: true },
    });

    return message?.externalId ?? null;
  }
}

export const salesService = new SalesService();
