import { NotFoundError, ValidationError } from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';
import { prisma } from '@/server/db/prisma';
import { runContentStrategist } from '../agents/contentStrategist';
import { growthQueue } from '../jobs/queue';
import { decideApproval } from '../policy/approvalPolicy';
import { checkPublicText, hasBlockingViolation } from '../policy/guardrails';
import { agentDeps, loadWorkspaceContext } from './context';
import { audit } from './audit';
import { learningService } from './LearningService';
import { workspaceService } from './WorkspaceService';

const log = logger.child('growth-content');

const MAX_PIECES_PER_PLAN = 30;

/**
 * Agente 2 na camada de aplicação: calendário editorial.
 *
 * O status inicial de cada peça sai da política de aprovação, não de um
 * `if` espalhado pela interface: no modo manual a peça nasce aguardando
 * aprovação; no autônomo, já aprovada e agendada.
 */
export class ContentService {
  async createPlan(
    workspaceId: string,
    userId: string,
    input: {
      title: string;
      periodStart: Date;
      periodEnd: Date;
      pieceCount: number;
    },
  ) {
    const workspace = await workspaceService.requireAccess(workspaceId, userId);

    if (input.periodEnd <= input.periodStart) {
      throw new ValidationError('O fim do período precisa ser depois do início.');
    }

    if (input.pieceCount < 1 || input.pieceCount > MAX_PIECES_PER_PLAN) {
      throw new ValidationError(
        `Gere entre 1 e ${MAX_PIECES_PER_PLAN} peças por plano.`,
      );
    }

    const strategy = await prisma.marketStrategy.findFirst({
      where: { workspaceId, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
    });

    if (!strategy) {
      throw new ValidationError(
        'Nenhuma estratégia ativa. Rode o estrategista de mercado antes de ' +
          'gerar o calendário — sem persona e objeções, o conteúdo vira ' +
          'palpite.',
      );
    }

    const plan = await prisma.contentPlan.create({
      data: {
        workspaceId,
        strategyId: strategy.id,
        title: input.title,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: 'DRAFT',
      },
    });

    await growthQueue.enqueue(
      'content.plan',
      { workspaceId, planId: plan.id, pieceCount: input.pieceCount },
      { workspaceId, dedupeKey: `content.plan:${plan.id}` },
    );

    await audit({
      workspaceId,
      actorType: 'HUMAN',
      actor: userId,
      action: 'content_plan.requested',
      entityType: 'ContentPlan',
      entityId: plan.id,
      mode: workspace.mode,
      metadata: { pieceCount: input.pieceCount },
    });

    return plan;
  }

  /** Executado pelo worker. */
  async runPlan(planId: string, pieceCount = 12, jobId?: string) {
    const plan = await prisma.contentPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundError('Plano de conteúdo', planId);

    const context = await loadWorkspaceContext(plan.workspaceId);

    if (!context.strategy) {
      throw new ValidationError('O plano perdeu a estratégia de referência.');
    }

    const insights = await learningService.activeInsightPhrases(
      plan.workspaceId,
    );

    const { data } = await runContentStrategist(
      {
        brand: context.brand,
        strategy: {
          persona: context.strategy.persona as never,
          pains: context.strategy.pains,
          desires: context.strategy.desires,
          objections: context.strategy.objections,
          valueProposition: context.strategy.valueProposition,
        },
        products: context.products,
        periodStart: plan.periodStart,
        periodEnd: plan.periodEnd,
        pieceCount,
        insights,
      },
      agentDeps(plan.workspaceId, {
        ...(jobId !== undefined ? { jobId } : {}),
      }),
    );

    const decision = decideApproval('CONTENT_PUBLISH', context.settings.mode);
    const initialStatus = decision.requiresApproval
      ? 'PENDING_APPROVAL'
      : 'APPROVED';

    const allowedPriceCents = context.products
      .map((p) => p.priceCents)
      .filter((cents): cents is number => cents !== null);

    const allowedUrls = context.products.flatMap((p) =>
      [p.checkoutUrl, p.schedulingUrl].filter(
        (url): url is string => url !== null,
      ),
    );

    let blockedCount = 0;

    for (const piece of data.pieces.slice(0, MAX_PIECES_PER_PLAN)) {
      // A legenda vai para o público: passa pelo mesmo guardrail da mensagem
      // de venda. Peça reprovada nasce como rascunho, para o humano corrigir.
      const violations = checkPublicText(`${piece.caption}\n${piece.script}`, {
        doNotSay: context.brand.doNotSay,
        allowedPriceCents,
        allowedUrls,
      });

      const blocked = hasBlockingViolation(violations);
      if (blocked) blockedCount++;

      await prisma.contentPiece.create({
        data: {
          workspaceId: plan.workspaceId,
          planId: plan.id,
          objective: piece.objective,
          format: piece.format,
          funnelStage: piece.funnelStage,
          status: blocked ? 'DRAFT' : initialStatus,
          audience: piece.audience,
          theme: piece.theme,
          hook: piece.hook,
          script: piece.script,
          caption: piece.caption,
          cta: piece.cta,
          keywords: piece.keywords,
          targets: ['INSTAGRAM'],
          scheduledFor: addDays(plan.periodStart, piece.dayOffset),
          rejectionReason: blocked
            ? `Guardrail: ${violations.map((v) => v.message).join(' ')}`
            : null,
        },
      });
    }

    await prisma.contentPlan.update({
      where: { id: planId },
      data: {
        status: 'ACTIVE',
        pillars: data.pillars,
        insightsUsed: insights,
        promptName: 'growth/content-plan',
        promptVersion: 'v1',
      },
    });

    await learningService.markInsightsApplied(plan.workspaceId);

    log.info('calendário gerado', {
      planId,
      pieces: data.pieces.length,
      blockedCount,
      usedInsights: insights.length,
    });

    return { pieces: data.pieces.length, blockedCount };
  }

  async approvePiece(pieceId: string, userId: string) {
    const piece = await this.requirePieceAccess(pieceId, userId);

    if (piece.status === 'PUBLISHED') {
      throw new ValidationError('Esta peça já foi publicada.');
    }

    const updated = await prisma.contentPiece.update({
      where: { id: pieceId },
      data: {
        status: 'APPROVED',
        approvedById: userId,
        approvedAt: new Date(),
        rejectionReason: null,
      },
    });

    await growthQueue.enqueue(
      'media.generate',
      { workspaceId: piece.workspaceId, contentPieceId: pieceId },
      {
        workspaceId: piece.workspaceId,
        dedupeKey: `media.generate:${pieceId}`,
      },
    );

    await audit({
      workspaceId: piece.workspaceId,
      actorType: 'HUMAN',
      actor: userId,
      action: 'content_piece.approved',
      entityType: 'ContentPiece',
      entityId: pieceId,
      mode: piece.workspace.mode,
    });

    return updated;
  }

  async rejectPiece(pieceId: string, userId: string, reason: string) {
    const piece = await this.requirePieceAccess(pieceId, userId);

    const updated = await prisma.contentPiece.update({
      where: { id: pieceId },
      data: { status: 'REJECTED', rejectionReason: reason },
    });

    await audit({
      workspaceId: piece.workspaceId,
      actorType: 'HUMAN',
      actor: userId,
      action: 'content_piece.rejected',
      entityType: 'ContentPiece',
      entityId: pieceId,
      mode: piece.workspace.mode,
      metadata: { reason },
    });

    return updated;
  }

  async listPieces(
    workspaceId: string,
    userId: string,
    filter: { status?: string } = {},
  ) {
    await workspaceService.requireAccess(workspaceId, userId);

    return prisma.contentPiece.findMany({
      where: {
        workspaceId,
        ...(filter.status !== undefined
          ? { status: filter.status as never }
          : {}),
      },
      include: {
        media: true,
        publications: true,
        plan: { select: { title: true } },
      },
      orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });
  }

  private async requirePieceAccess(pieceId: string, userId: string) {
    const piece = await prisma.contentPiece.findUnique({
      where: { id: pieceId },
      include: { workspace: true },
    });

    if (!piece) throw new NotFoundError('Conteúdo', pieceId);

    await workspaceService.requireAccess(piece.workspaceId, userId);

    return piece;
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export const contentService = new ContentService();
