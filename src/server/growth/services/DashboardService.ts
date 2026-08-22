import { prisma } from '@/server/db/prisma';
import { workspaceService } from './WorkspaceService';
import { learningService } from './LearningService';

/**
 * Consultas do painel.
 *
 * Ficam juntas em um serviço porque as páginas são Server Components: cada
 * uma dispara suas consultas direto, e sem um lugar comum a mesma contagem de
 * leads acabaria implementada de três jeitos ligeiramente diferentes — que é
 * como um painel passa a mostrar dois números para a mesma coisa.
 */
export class DashboardService {
  async summary(workspaceId: string, userId: string) {
    await workspaceService.requireAccess(workspaceId, userId);

    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      leadsTotal,
      leadsHot,
      leadsNew,
      dealsOpen,
      dealsWon,
      dealsLost,
      revenue,
      published,
      scheduled,
      pendingContent,
      pendingApprovals,
      waitingHuman,
      queueStats,
      cost,
      metrics,
    ] = await Promise.all([
      prisma.lead.count({ where: { workspaceId } }),
      prisma.lead.count({
        where: { workspaceId, temperature: { in: ['HOT', 'READY'] } },
      }),
      prisma.lead.count({
        where: { workspaceId, createdAt: { gte: since7d } },
      }),
      prisma.deal.count({ where: { workspaceId, status: 'OPEN' } }),
      prisma.deal.count({ where: { workspaceId, status: 'WON' } }),
      prisma.deal.count({ where: { workspaceId, status: 'LOST' } }),
      prisma.deal.aggregate({
        where: { workspaceId, status: 'WON' },
        _sum: { valueCents: true },
      }),
      prisma.publication.count({
        where: { workspaceId, status: 'PUBLISHED' },
      }),
      prisma.contentPiece.count({
        where: { workspaceId, status: { in: ['APPROVED', 'SCHEDULED'] } },
      }),
      prisma.contentPiece.count({
        where: { workspaceId, status: 'PENDING_APPROVAL' },
      }),
      prisma.approvalRequest.count({ where: { workspaceId, status: 'PENDING' } }),
      prisma.conversation.count({
        where: { workspaceId, status: 'WAITING_HUMAN' },
      }),
      prisma.growthJob.groupBy({
        by: ['status'],
        where: { workspaceId },
        _count: { _all: true },
      }),
      prisma.aIUsageLog.aggregate({
        where: { workspaceId, createdAt: { gte: since30d } },
        _sum: { estimatedCostUsd: true, inputTokens: true, outputTokens: true },
      }),
      prisma.contentMetric.aggregate({
        where: {
          publication: { workspaceId },
          capturedAt: { gte: since30d },
        },
        _sum: { reach: true, impressions: true, comments: true, likes: true },
      }),
    ]);

    const revenueCents = revenue._sum.valueCents ?? 0;

    return {
      leads: { total: leadsTotal, hot: leadsHot, new7d: leadsNew },
      deals: {
        open: dealsOpen,
        won: dealsWon,
        lost: dealsLost,
        revenueCents,
        // Conversão de lead em venda: o número que decide se o sistema paga a
        // própria conta.
        conversionRate: leadsTotal > 0 ? dealsWon / leadsTotal : 0,
      },
      content: { published, scheduled, pendingApproval: pendingContent },
      operations: {
        pendingApprovals,
        waitingHuman,
        queue: Object.fromEntries(
          queueStats.map((row) => [row.status, row._count._all]),
        ) as Record<string, number>,
      },
      cost: {
        last30dUsd: cost._sum.estimatedCostUsd ?? 0,
        inputTokens: cost._sum.inputTokens ?? 0,
        outputTokens: cost._sum.outputTokens ?? 0,
      },
      reach: {
        last30d: metrics._sum.reach ?? 0,
        impressions: metrics._sum.impressions ?? 0,
        engagement: (metrics._sum.likes ?? 0) + (metrics._sum.comments ?? 0),
      },
    };
  }

  /** Desempenho por peça — a tabela "o que funcionou" do painel. */
  async contentPerformance(workspaceId: string, userId: string, days = 30) {
    await workspaceService.requireAccess(workspaceId, userId);

    const periodEnd = new Date();
    const periodStart = new Date(
      periodEnd.getTime() - days * 24 * 60 * 60 * 1000,
    );

    const performance = await learningService.collectPerformance(
      workspaceId,
      periodStart,
      periodEnd,
    );

    return performance.sort((a, b) => b.leads - a.leads);
  }

  async funnel(workspaceId: string, userId: string) {
    await workspaceService.requireAccess(workspaceId, userId);

    const stages = await prisma.deal.groupBy({
      by: ['stage'],
      where: { workspaceId },
      _count: { _all: true },
      _sum: { valueCents: true },
    });

    return stages.map((stage) => ({
      stage: stage.stage,
      count: stage._count._all,
      valueCents: stage._sum.valueCents ?? 0,
    }));
  }

  async recentAudit(workspaceId: string, userId: string, take = 20) {
    await workspaceService.requireAccess(workspaceId, userId);

    return prisma.auditLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}

export const dashboardService = new DashboardService();
