import { logger } from '@/server/core/shared/logger';
import { prisma } from '@/server/db/prisma';
import { runLearningAnalyst } from '../agents/learningAnalyst';
import {
  aggregateByDimension,
  round,
  sum,
  type PiecePerformance,
} from '../analytics/performance';
import { agentDeps, loadWorkspaceContext } from './context';
import { workspaceService } from './WorkspaceService';

const log = logger.child('growth-learning');

/**
 * Aprendizado com resultados — o laço que fecha o sistema.
 *
 * Divisão deliberada de trabalho: **os números são calculados aqui**, em
 * TypeScript, e o modelo só interpreta. Média calculada por LLM é média em que
 * não se pode confiar, e "conteúdos sobre X geram mais leads" precisa vir de
 * uma divisão de verdade — senão o sistema aprende a própria alucinação e
 * realimenta o calendário seguinte com ela.
 */

export class LearningService {
  /**
   * Frases prontas para entrar no prompt do estrategista de conteúdo.
   *
   * Filtra por confiança: um padrão observado em três posts não pode redefinir
   * o calendário do mês.
   */
  async activeInsightPhrases(workspaceId: string): Promise<string[]> {
    const insights = await prisma.learningInsight.findMany({
      where: { workspaceId, appliedAt: null, confidence: { gte: 0.4 } },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      take: 8,
    });

    return insights.map(
      (insight) => `${insight.statement} → ${insight.recommendation}`,
    );
  }

  async markInsightsApplied(workspaceId: string): Promise<void> {
    await prisma.learningInsight.updateMany({
      where: { workspaceId, appliedAt: null },
      data: { appliedAt: new Date() },
    });
  }

  /** Executado pelo worker (cron diário). */
  async analyze(workspaceId: string, days = 30, jobId?: string) {
    const periodEnd = new Date();
    const periodStart = new Date(
      periodEnd.getTime() - days * 24 * 60 * 60 * 1000,
    );

    const performance = await this.collectPerformance(
      workspaceId,
      periodStart,
      periodEnd,
    );

    // Menos de três publicações não é amostra: é anedota. Rodar o modelo aqui
    // só produziria conclusão bonita sobre nada.
    if (performance.length < 3) {
      log.info('amostra insuficiente para análise', {
        workspaceId,
        publications: performance.length,
      });

      return { insights: 0, skipped: true as const };
    }

    const aggregates = aggregateByDimension(performance);
    const context = await loadWorkspaceContext(workspaceId);

    const { data } = await runLearningAnalyst(
      {
        brandName: context.brand.name,
        language: context.brand.language,
        periodStart,
        periodEnd,
        performance,
        aggregates,
      },
      agentDeps(workspaceId, { ...(jobId !== undefined ? { jobId } : {}) }),
    );

    for (const insight of data.insights) {
      await prisma.learningInsight.create({
        data: {
          workspaceId,
          dimension: insight.dimension,
          subject: insight.subject,
          metric: insight.metric,
          value: insight.value,
          sampleSize: insight.sampleSize,
          confidence: insight.confidence,
          statement: insight.statement,
          recommendation: insight.recommendation,
          evidence: {
            aggregates: aggregates.filter(
              (aggregate) => aggregate.subject === insight.subject,
            ),
          },
          periodStart,
          periodEnd,
        },
      });
    }

    log.info('análise de aprendizado concluída', {
      workspaceId,
      insights: data.insights.length,
      sample: performance.length,
    });

    return { insights: data.insights.length, skipped: false as const };
  }

  /**
   * Desempenho por peça, ligando conteúdo → lead → receita.
   *
   * É a junção que justifica todo o rastreamento de origem espalhado pelo
   * schema: sem `sourceContentPieceId` em `Lead`, o sistema saberia quais
   * posts tiveram alcance, mas não quais deram dinheiro.
   */
  async collectPerformance(
    workspaceId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<PiecePerformance[]> {
    const pieces = await prisma.contentPiece.findMany({
      where: {
        workspaceId,
        publications: {
          some: {
            status: 'PUBLISHED',
            publishedAt: { gte: periodStart, lte: periodEnd },
          },
        },
      },
      include: {
        publications: {
          include: { metrics: { orderBy: { capturedAt: 'desc' }, take: 1 } },
        },
        conversations: { select: { id: true } },
        leads: {
          select: {
            id: true,
            temperature: true,
            deals: {
              select: { status: true, valueCents: true },
            },
          },
        },
      },
    });

    return pieces.map((piece) => {
      const metrics = piece.publications.flatMap((pub) => pub.metrics);

      const reach = sum(metrics.map((m) => m.reach));
      const impressions = sum(metrics.map((m) => m.impressions));
      const comments = sum(metrics.map((m) => m.comments));
      const engagement =
        sum(metrics.map((m) => m.likes)) +
        comments +
        sum(metrics.map((m) => m.shares)) +
        sum(metrics.map((m) => m.saves));

      const wonDeals = piece.leads.flatMap((lead) =>
        lead.deals.filter((deal) => deal.status === 'WON'),
      );

      const publishedAt = piece.publications
        .map((pub) => pub.publishedAt)
        .filter((date): date is Date => date !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0];

      return {
        contentPieceId: piece.id,
        theme: piece.theme,
        hook: piece.hook,
        cta: piece.cta,
        format: piece.format,
        funnelStage: piece.funnelStage,
        objective: piece.objective,
        publishedAt: publishedAt?.toISOString() ?? null,
        reach,
        impressions,
        engagement,
        engagementRate: reach > 0 ? round(engagement / reach, 4) : 0,
        comments,
        conversations: piece.conversations.length,
        leads: piece.leads.length,
        qualifiedLeads: piece.leads.filter((lead) =>
          ['HOT', 'READY'].includes(lead.temperature),
        ).length,
        deals: wonDeals.length,
        revenueCents: sum(wonDeals.map((deal) => deal.valueCents ?? 0)),
      };
    });
  }

  async listInsights(workspaceId: string, userId: string) {
    await workspaceService.requireAccess(workspaceId, userId);

    return prisma.learningInsight.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }
}

export const learningService = new LearningService();
