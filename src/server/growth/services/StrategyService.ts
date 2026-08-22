import { NotFoundError } from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';
import { prisma } from '@/server/db/prisma';
import { runMarketStrategist } from '../agents/marketStrategist';
import { growthQueue } from '../jobs/queue';
import { agentDeps, loadWorkspaceContext } from './context';
import { audit } from './audit';
import { workspaceService } from './WorkspaceService';

const log = logger.child('growth-strategy');

/**
 * Agente 1 na camada de aplicação.
 *
 * O registro nasce como DRAFT **antes** de o agente rodar, com os campos
 * vazios. Parece estranho, mas é o que dá ao painel algo para mostrar
 * enquanto a pesquisa acontece, e à fila um alvo para retentar quando o
 * modelo falha — um job que carrega o briefing no payload perde o rastro se
 * morrer no meio.
 */
export class StrategyService {
  async request(
    workspaceId: string,
    userId: string,
    input: { brief: string; niche: string },
  ) {
    const workspace = await workspaceService.requireAccess(workspaceId, userId);

    const strategy = await prisma.marketStrategy.create({
      data: {
        workspaceId,
        status: 'DRAFT',
        brief: input.brief,
        niche: input.niche,
        persona: {},
        pains: [],
        desires: [],
        objections: [],
        competitors: [],
        opportunities: [],
        valueProposition: '',
        offer: {},
        toneOfVoice: '',
      },
    });

    await growthQueue.enqueue(
      'strategy.research',
      { workspaceId, strategyId: strategy.id },
      { workspaceId, dedupeKey: `strategy.research:${strategy.id}` },
    );

    await audit({
      workspaceId,
      actorType: 'HUMAN',
      actor: userId,
      action: 'strategy.requested',
      entityType: 'MarketStrategy',
      entityId: strategy.id,
      mode: workspace.mode,
      metadata: { niche: input.niche },
    });

    return strategy;
  }

  /** Executado pelo worker. */
  async run(strategyId: string, jobId?: string) {
    const strategy = await prisma.marketStrategy.findUnique({
      where: { id: strategyId },
    });

    if (!strategy) throw new NotFoundError('Estratégia', strategyId);

    const context = await loadWorkspaceContext(strategy.workspaceId);

    const { data } = await runMarketStrategist(
      {
        brief: strategy.brief,
        niche: strategy.niche,
        brand: context.brand,
        products: context.products,
      },
      agentDeps(strategy.workspaceId, {
        cache: true,
        ...(jobId !== undefined ? { jobId } : {}),
      }),
    );

    // Só uma estratégia fica ativa: o agente de vendas não pode escolher entre
    // duas propostas de valor conflitantes.
    await prisma.marketStrategy.updateMany({
      where: { workspaceId: strategy.workspaceId, status: 'ACTIVE' },
      data: { status: 'ARCHIVED' },
    });

    const updated = await prisma.marketStrategy.update({
      where: { id: strategyId },
      data: {
        status: 'ACTIVE',
        niche: data.niche,
        persona: data.persona,
        pains: data.pains,
        desires: data.desires,
        objections: data.objections,
        competitors: data.competitors,
        opportunities: data.opportunities,
        valueProposition: data.valueProposition,
        offer: { ...data.offer, hypotheses: data.hypotheses },
        toneOfVoice: data.toneOfVoice,
        promptName: 'growth/market-strategy',
        promptVersion: 'v1',
      },
    });

    // A marca herda o que ainda não foi preenchido à mão: é o que faz o
    // primeiro conteúdo já sair com proposta e tom coerentes.
    await prisma.brandProfile.updateMany({
      where: { workspaceId: strategy.workspaceId, valueProposition: null },
      data: { valueProposition: data.valueProposition },
    });

    log.info('estratégia concluída', {
      strategyId,
      niche: data.niche,
      opportunities: data.opportunities.length,
    });

    return updated;
  }

  async listForWorkspace(workspaceId: string, userId: string) {
    await workspaceService.requireAccess(workspaceId, userId);

    return prisma.marketStrategy.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
}

export const strategyService = new StrategyService();
