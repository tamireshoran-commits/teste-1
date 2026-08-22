import { env } from '@/server/config/env';
import { NotFoundError } from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';
import { prisma } from '@/server/db/prisma';
import { runFollowUpWriter } from '../agents/followUpWriter';
import { growthQueue } from '../jobs/queue';
import { decideApproval } from '../policy/approvalPolicy';
import {
  evaluateOutboundMessage,
  followUpDelayMs,
} from '../policy/messagingPolicy';
import { agentDeps, loadWorkspaceContext } from './context';
import { approvalService } from './ApprovalService';
import { audit } from './audit';
import { conversationService } from './ConversationService';
import { leadService } from './LeadService';
import { workspaceService } from './WorkspaceService';

const log = logger.child('growth-followup');

/** Silêncio a partir do qual uma conversa é considerada parada. */
const IDLE_HOURS = 48;

/**
 * Follow-up com contexto.
 *
 * Duas regras definem o comportamento: o intervalo cresce a cada tentativa
 * (2, 5, 10 dias) e o agente pode dizer "não tenho nada novo a dizer" e não
 * enviar. Um sistema de follow-up sem essas duas coisas produz "oi, tudo
 * bem?" a cada 24h — que é como se perde o lead e a conta ao mesmo tempo.
 *
 * Vale notar o que acontece na prática com mensagem direta: passadas 24h da
 * última mensagem da pessoa, a janela da plataforma fecha e **nenhum
 * follow-up pode sair**. A tarefa então é marcada como SKIPPED e a conversa
 * vai para atendimento humano. É a resposta honesta: o caminho para retomar
 * existe, mas não é automático.
 */
export class FollowUpService {
  /** Agenda um follow-up para depois de uma mensagem enviada. */
  async schedule(input: {
    workspaceId: string;
    leadId: string;
    conversationId: string;
    reason: string;
  }) {
    const pending = await prisma.followUpTask.findFirst({
      where: {
        leadId: input.leadId,
        status: 'PENDING',
      },
      select: { id: true },
    });

    if (pending) return pending;

    const previous = await prisma.followUpTask.count({
      where: { leadId: input.leadId },
    });

    const attempt = previous + 1;
    const maxAttempts = 3;

    if (attempt > maxAttempts) {
      log.debug('limite de follow-ups atingido', { leadId: input.leadId });
      return null;
    }

    const task = await prisma.followUpTask.create({
      data: {
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        conversationId: input.conversationId,
        reason: input.reason,
        attempt,
        maxAttempts,
        scheduledFor: new Date(Date.now() + followUpDelayMs(attempt)),
      },
    });

    await growthQueue.enqueue(
      'followup.send',
      { workspaceId: input.workspaceId, followUpTaskId: task.id },
      {
        workspaceId: input.workspaceId,
        runAt: task.scheduledFor,
        dedupeKey: `followup.send:${task.id}`,
      },
    );

    return task;
  }

  /**
   * Varre conversas paradas e cria as tarefas que faltam.
   *
   * Existe além do agendamento no envio porque conversa some por vários
   * caminhos — job que morreu, humano que assumiu e largou, lead criado antes
   * de o follow-up existir. A varredura é a rede de segurança.
   */
  async scan(workspaceId: string) {
    const idleSince = new Date(Date.now() - IDLE_HOURS * 60 * 60 * 1000);

    const leads = await prisma.lead.findMany({
      where: {
        workspaceId,
        temperature: { in: ['WARM', 'HOT', 'READY'] },
        contact: { optOut: false },
        conversation: {
          status: { in: ['OPEN', 'WAITING_CUSTOMER'] },
          updatedAt: { lt: idleSince },
        },
        followUps: { none: { status: 'PENDING' } },
        deals: { none: { status: 'WON' } },
      },
      include: { conversation: { select: { id: true } } },
      take: 50,
    });

    let scheduled = 0;

    for (const lead of leads) {
      if (!lead.conversation) continue;

      const task = await this.schedule({
        workspaceId,
        leadId: lead.id,
        conversationId: lead.conversation.id,
        reason:
          lead.intent !== null
            ? `Demonstrou interesse (${lead.intent}) e não respondeu desde então.`
            : 'Conversa parada após demonstrar interesse.',
      });

      if (task) scheduled++;
    }

    log.info('varredura de follow-up', { workspaceId, scheduled });

    return { scheduled, candidates: leads.length };
  }

  /** Executado pelo worker no horário agendado. */
  async send(followUpTaskId: string, jobId?: string) {
    const task = await prisma.followUpTask.findUnique({
      where: { id: followUpTaskId },
      include: {
        lead: { include: { contact: true } },
        conversation: true,
        workspace: true,
      },
    });

    if (!task) throw new NotFoundError('Follow-up', followUpTaskId);

    if (task.status !== 'PENDING') {
      return { skipped: true as const, reason: 'já processado' };
    }

    // Se a pessoa respondeu depois do agendamento, o follow-up perdeu o
    // sentido: quem responde não precisa ser lembrado.
    const respondedAfter =
      task.conversation.lastInboundAt !== null &&
      task.conversation.lastOutboundAt !== null &&
      task.conversation.lastInboundAt > task.conversation.lastOutboundAt;

    if (respondedAfter) {
      await this.cancel(task.id, 'O contato respondeu; follow-up desnecessário.');
      return { skipped: true as const, reason: 'contato respondeu' };
    }

    const context = await loadWorkspaceContext(task.workspaceId);

    const decision = evaluateOutboundMessage({
      now: new Date(),
      channel: task.conversation.channel,
      lastInboundAt: task.conversation.lastInboundAt,
      contactOptOut: task.lead.contact.optOut,
      conversationClosed: task.conversation.status === 'CLOSED',
      messagesSentToday: await conversationService.countOutboundToday(
        task.workspaceId,
        task.lead.contactId,
      ),
      maxMessagesPerContactPerDay:
        context.settings.maxMessagesPerContactPerDay,
      quietHours: {
        start: context.settings.quietHoursStart,
        end: context.settings.quietHoursEnd,
      },
      timezone: context.settings.timezone,
      windowHours: env.GROWTH_MESSAGE_WINDOW_HOURS,
      hasPendingOutbound: await conversationService.hasPendingOutbound(
        task.conversationId,
      ),
    });

    if (!decision.allowed) {
      if (decision.retryAt !== undefined) {
        await prisma.followUpTask.update({
          where: { id: task.id },
          data: { scheduledFor: decision.retryAt },
        });

        await growthQueue.enqueue(
          'followup.send',
          { workspaceId: task.workspaceId, followUpTaskId: task.id },
          {
            workspaceId: task.workspaceId,
            runAt: decision.retryAt,
            dedupeKey: `followup.send:${task.id}:${decision.retryAt.toISOString()}`,
          },
        );

        return { deferred: true as const, reason: decision.reason };
      }

      await prisma.followUpTask.update({
        where: { id: task.id },
        data: { status: 'SKIPPED', cancelledReason: decision.reason },
      });

      if (decision.code === 'OUTSIDE_WINDOW') {
        await conversationService.assignToHuman(
          task.conversationId,
          'Janela de resposta fechada: só um humano pode retomar este contato.',
        );
      }

      return { skipped: true as const, reason: decision.reason };
    }

    const history = await conversationService.history(task.conversationId);
    const lastInbound = [...history]
      .reverse()
      .find((turn) => turn.direction === 'INBOUND');

    const daysSinceLast =
      lastInbound !== undefined
        ? Math.floor(
            (Date.now() - lastInbound.at.getTime()) / (24 * 60 * 60 * 1000),
          )
        : task.attempt * 2;

    const { data } = await runFollowUpWriter(
      {
        brand: context.brand,
        products: context.products,
        reason: task.reason,
        attempt: task.attempt,
        maxAttempts: task.maxAttempts,
        daysSinceLast,
        leadSummary: leadService.summarize(task.lead),
        history,
      },
      agentDeps(task.workspaceId, { ...(jobId !== undefined ? { jobId } : {}) }),
    );

    if (!data.safeToSend) {
      await prisma.followUpTask.update({
        where: { id: task.id },
        data: {
          status: 'SKIPPED',
          cancelledReason:
            data.followUp.skipReason ??
            (data.violations.length > 0
              ? `Guardrail: ${data.violations.map((v) => v.message).join(' ')}`
              : 'O agente não encontrou nada novo a dizer.'),
        },
      });

      return { skipped: true as const, reason: 'sem conteúdo novo' };
    }

    const approval = decideApproval('FOLLOW_UP_SEND', context.settings.mode);

    const message = await prisma.message.create({
      data: {
        workspaceId: task.workspaceId,
        conversationId: task.conversationId,
        direction: 'OUTBOUND',
        status: approval.requiresApproval ? 'PENDING_APPROVAL' : 'QUEUED',
        text: data.followUp.message,
        agent: 'SALES_REP',
        meta: { followUpTaskId: task.id, attempt: task.attempt },
      },
    });

    if (approval.requiresApproval) {
      await approvalService.request({
        workspaceId: task.workspaceId,
        actionType: 'FOLLOW_UP_SEND',
        entityType: 'Message',
        entityId: message.id,
        title: `Follow-up ${task.attempt}/${task.maxAttempts} para ${task.lead.contact.username ?? 'contato'}`,
        payload: { text: data.followUp.message, reason: task.reason },
        requestedByAgent: 'SALES_REP',
      });
    } else {
      await growthQueue.enqueue(
        'message.send',
        { workspaceId: task.workspaceId, messageId: message.id },
        {
          workspaceId: task.workspaceId,
          dedupeKey: `message.send:${message.id}`,
        },
      );
    }

    await prisma.followUpTask.update({
      where: { id: task.id },
      data: { status: 'SENT', draft: data.followUp.message, sentMessageId: message.id },
    });

    await audit({
      workspaceId: task.workspaceId,
      actorType: 'AGENT',
      actor: 'SALES_REP',
      action: 'followup.created',
      entityType: 'FollowUpTask',
      entityId: task.id,
      mode: context.settings.mode,
      metadata: { attempt: task.attempt, requiresApproval: approval.requiresApproval },
    });

    return { messageId: message.id, requiresApproval: approval.requiresApproval };
  }

  async cancel(taskId: string, reason: string) {
    return prisma.followUpTask.update({
      where: { id: taskId },
      data: { status: 'CANCELLED', cancelledReason: reason },
    });
  }

  async listForWorkspace(workspaceId: string, userId: string) {
    await workspaceService.requireAccess(workspaceId, userId);

    return prisma.followUpTask.findMany({
      where: { workspaceId },
      include: { lead: { include: { contact: true } } },
      orderBy: { scheduledFor: 'asc' },
      take: 100,
    });
  }
}

export const followUpService = new FollowUpService();
