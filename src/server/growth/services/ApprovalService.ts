import { NotFoundError, ValidationError } from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';
import { prisma } from '@/server/db/prisma';
import { growthQueue } from '../jobs/queue';
import { ACTION_LABEL, ACTION_RISK } from '../policy/approvalPolicy';
import type { GrowthAction } from '../types';
import { audit } from './audit';
import { workspaceService } from './WorkspaceService';

const log = logger.child('growth-approval');

/**
 * Fila de aprovação humana.
 *
 * O ponto central: **a aprovação não executa nada diretamente**. Ela muda o
 * estado da entidade e enfileira o job correspondente. Assim o caminho de
 * execução é o mesmo com e sem humano no meio — o que evita o bug clássico
 * desse tipo de sistema, em que o fluxo aprovado passa por um código diferente
 * do fluxo automático e só um dos dois está certo.
 *
 * Também é por isso que este serviço não importa nenhum outro serviço: se
 * aprovar significasse chamar `PublishingService`, teríamos dependência
 * circular e dois caminhos de execução.
 */
export class ApprovalService {
  async request(input: {
    workspaceId: string;
    actionType: GrowthAction;
    entityType: string;
    entityId: string;
    title: string;
    payload: Record<string, unknown>;
    requestedByAgent?: string;
    expiresAt?: Date;
  }) {
    const existing = await prisma.approvalRequest.findFirst({
      where: {
        workspaceId: input.workspaceId,
        actionType: input.actionType,
        entityType: input.entityType,
        entityId: input.entityId,
        status: 'PENDING',
      },
    });

    if (existing) return existing;

    const request = await prisma.approvalRequest.create({
      data: {
        workspaceId: input.workspaceId,
        actionType: input.actionType,
        riskLevel: ACTION_RISK[input.actionType],
        entityType: input.entityType,
        entityId: input.entityId,
        title: input.title,
        payload: input.payload as object,
        requestedByAgent: input.requestedByAgent ?? null,
        expiresAt: input.expiresAt ?? null,
      },
    });

    log.info('aprovação solicitada', {
      workspaceId: input.workspaceId,
      action: input.actionType,
      entityId: input.entityId,
    });

    return request;
  }

  async hasApproval(
    actionType: GrowthAction,
    entityType: string,
    entityId: string,
  ): Promise<boolean> {
    const approved = await prisma.approvalRequest.findFirst({
      where: { actionType, entityType, entityId, status: 'APPROVED' },
      select: { id: true },
    });

    return approved !== null;
  }

  async listPending(workspaceId: string, userId: string) {
    await workspaceService.requireAccess(workspaceId, userId);

    return prisma.approvalRequest.findMany({
      where: { workspaceId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }

  async decide(
    approvalId: string,
    userId: string,
    decision: 'APPROVED' | 'REJECTED',
    notes?: string,
  ) {
    const request = await prisma.approvalRequest.findUnique({
      where: { id: approvalId },
      include: { workspace: true },
    });

    if (!request) throw new NotFoundError('Aprovação', approvalId);

    await workspaceService.requireAccess(request.workspaceId, userId);

    if (request.status !== 'PENDING') {
      throw new ValidationError(
        `Esta solicitação já foi ${request.status === 'APPROVED' ? 'aprovada' : 'decidida'}.`,
      );
    }

    const updated = await prisma.approvalRequest.update({
      where: { id: approvalId },
      data: {
        status: decision,
        decidedById: userId,
        decidedAt: new Date(),
        notes: notes ?? null,
      },
    });

    if (decision === 'APPROVED') {
      await this.dispatch(request.workspaceId, request.actionType, {
        entityType: request.entityType,
        entityId: request.entityId,
      });
    } else {
      await this.cancel(request.actionType, {
        entityType: request.entityType,
        entityId: request.entityId,
        reason: notes ?? 'Reprovado por decisão humana.',
      });
    }

    await audit({
      workspaceId: request.workspaceId,
      actorType: 'HUMAN',
      actor: userId,
      action: `approval.${decision.toLowerCase()}`,
      entityType: request.entityType,
      entityId: request.entityId,
      mode: request.workspace.mode,
      metadata: { actionType: request.actionType, label: ACTION_LABEL[request.actionType as GrowthAction] },
    });

    return updated;
  }

  /** Aprovado: coloca a entidade no estado de execução e enfileira o job. */
  private async dispatch(
    workspaceId: string,
    actionType: string,
    target: { entityType: string; entityId: string },
  ): Promise<void> {
    switch (actionType) {
      case 'MEDIA_GENERATE':
        await growthQueue.enqueue(
          'media.generate',
          { workspaceId, contentPieceId: target.entityId },
          {
            workspaceId,
            dedupeKey: `media.generate:approved:${target.entityId}`,
          },
        );
        return;

      case 'CONTENT_PUBLISH': {
        const publication = await prisma.publication.update({
          where: { id: target.entityId },
          data: { status: 'SCHEDULED' },
        });

        await growthQueue.enqueue(
          'publish.execute',
          { workspaceId, publicationId: publication.id },
          {
            workspaceId,
            runAt: publication.scheduledFor ?? new Date(),
            dedupeKey: `publish.execute:${publication.id}`,
          },
        );
        return;
      }

      case 'DM_SEND':
      case 'COMMENT_REPLY':
      case 'FOLLOW_UP_SEND':
      case 'CHECKOUT_LINK_SEND': {
        await prisma.message.update({
          where: { id: target.entityId },
          data: { status: 'QUEUED' },
        });

        await growthQueue.enqueue(
          'message.send',
          { workspaceId, messageId: target.entityId },
          { workspaceId, dedupeKey: `message.send:${target.entityId}` },
        );
        return;
      }

      default:
        log.warn('aprovação sem ação associada', { actionType });
    }
  }

  /** Reprovado: encerra a entidade para não ficar pendente para sempre. */
  private async cancel(
    actionType: string,
    target: { entityType: string; entityId: string; reason: string },
  ): Promise<void> {
    if (target.entityType === 'Message') {
      await prisma.message.update({
        where: { id: target.entityId },
        data: { status: 'REJECTED', blockedReason: target.reason },
      });
      return;
    }

    if (target.entityType === 'Publication') {
      await prisma.publication.update({
        where: { id: target.entityId },
        data: { status: 'CANCELLED', errorMessage: target.reason },
      });
      return;
    }

    if (target.entityType === 'ContentPiece' && actionType === 'MEDIA_GENERATE') {
      await prisma.contentPiece.update({
        where: { id: target.entityId },
        data: { status: 'REJECTED', rejectionReason: target.reason },
      });
    }
  }
}

export const approvalService = new ApprovalService();
