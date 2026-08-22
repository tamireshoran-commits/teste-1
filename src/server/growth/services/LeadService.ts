import { NotFoundError } from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';
import { prisma } from '@/server/db/prisma';
import {
  reconcileScore,
  runLeadQualifier,
  type LeadQualificationOutput,
} from '../agents/leadQualifier';
import type { ProductSummary } from '../types';
import { agentDeps, loadWorkspaceContext } from './context';
import { conversationService } from './ConversationService';
import { workspaceService } from './WorkspaceService';

const log = logger.child('growth-lead');

/**
 * Agente 5 na camada de aplicação.
 *
 * Um contato vira lead na primeira qualificação e continua o mesmo lead
 * depois: a temperatura sobe e desce conforme a conversa, mas o registro é um
 * só. Criar um lead por mensagem inflaria o funil e destruiria a taxa de
 * conversão como métrica — que é exatamente o número que o dono do negócio
 * olha para decidir se o sistema funciona.
 */
export class LeadService {
  async qualify(
    conversationId: string,
    messageText: string,
    jobId?: string,
  ) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        contact: true,
        sourceContentPiece: { select: { id: true, theme: true } },
      },
    });

    if (!conversation) throw new NotFoundError('Conversa', conversationId);

    const context = await loadWorkspaceContext(conversation.workspaceId);
    const history = await conversationService.history(conversationId);

    const { data } = await runLeadQualifier(
      {
        brandName: context.brand.name,
        language: context.brand.language,
        channel: conversation.channel,
        message: messageText,
        history,
        products: context.products,
        sourceContent: conversation.sourceContentPiece?.theme ?? null,
      },
      agentDeps(conversation.workspaceId, {
        ...(jobId !== undefined ? { jobId } : {}),
      }),
    );

    const productId = validProductId(data.productId, context.products);
    const score = reconcileScore(data.temperature, data.score);

    const lead = await prisma.lead.upsert({
      where: { contactId: conversation.contactId },
      create: {
        workspaceId: conversation.workspaceId,
        contactId: conversation.contactId,
        conversationId,
        temperature: data.temperature,
        score,
        intent: data.intent,
        problem: data.problem,
        productId,
        budget: data.budget,
        urgency: data.urgency,
        decisionStage: data.decisionStage,
        objections: data.objections,
        funnelStage: data.funnelStage,
        qualifiedAt: new Date(),
        sourceContentPieceId: conversation.sourceContentPieceId,
      },
      update: {
        conversationId,
        temperature: data.temperature,
        score,
        // Campo novo só sobrescreve o antigo quando traz informação: o modelo
        // devolve null para o que não foi dito nesta mensagem, e apagar o que
        // a pessoa disse ontem seria perder a qualificação.
        ...(data.intent !== null ? { intent: data.intent } : {}),
        ...(data.problem !== null ? { problem: data.problem } : {}),
        ...(productId !== null ? { productId } : {}),
        ...(data.budget !== null ? { budget: data.budget } : {}),
        ...(data.urgency !== null ? { urgency: data.urgency } : {}),
        ...(data.decisionStage !== null
          ? { decisionStage: data.decisionStage }
          : {}),
        ...(data.objections.length > 0 ? { objections: data.objections } : {}),
        funnelStage: data.funnelStage,
        qualifiedAt: new Date(),
      },
    });

    if (data.handoffToHuman) {
      await conversationService.assignToHuman(
        conversationId,
        data.handoffReason ?? 'O qualificador pediu atendimento humano.',
      );
    }

    // Lead quente sem negócio aberto vira negócio: é o registro que faz o
    // funil de vendas existir no painel.
    if (
      (data.temperature === 'HOT' || data.temperature === 'READY') &&
      !(await this.hasOpenDeal(lead.id))
    ) {
      await prisma.deal.create({
        data: {
          workspaceId: conversation.workspaceId,
          leadId: lead.id,
          productId,
          stage: 'QUALIFIED',
          status: 'OPEN',
          valueCents: priceOf(productId, context.products),
        },
      });
    }

    log.info('lead qualificado', {
      conversationId,
      temperature: data.temperature,
      score,
      handoff: data.handoffToHuman,
    });

    return { lead, qualification: data };
  }

  /** Resumo curto do lead para o prompt do vendedor. */
  summarize(lead: {
    temperature: string;
    score: number;
    intent: string | null;
    problem: string | null;
    budget: string | null;
    urgency: string | null;
    decisionStage: string | null;
    objections: unknown;
  }): string {
    const objections = Array.isArray(lead.objections)
      ? lead.objections.filter((o): o is string => typeof o === 'string')
      : [];

    const parts = [
      `temperatura ${lead.temperature} (score ${lead.score})`,
      lead.intent !== null ? `interesse: ${lead.intent}` : null,
      lead.problem !== null ? `problema: ${lead.problem}` : null,
      lead.budget !== null ? `orçamento: ${lead.budget}` : null,
      lead.urgency !== null ? `urgência: ${lead.urgency}` : null,
      lead.decisionStage !== null ? `estágio: ${lead.decisionStage}` : null,
      objections.length > 0 ? `objeções: ${objections.join('; ')}` : null,
    ].filter((part): part is string => part !== null);

    return parts.join(' | ');
  }

  async listForWorkspace(
    workspaceId: string,
    userId: string,
    filter: { temperature?: string } = {},
  ) {
    await workspaceService.requireAccess(workspaceId, userId);

    return prisma.lead.findMany({
      where: {
        workspaceId,
        ...(filter.temperature !== undefined
          ? { temperature: filter.temperature as never }
          : {}),
      },
      include: {
        contact: true,
        product: true,
        deals: true,
        conversation: { select: { id: true, channel: true, status: true } },
      },
      orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
      take: 100,
    });
  }

  private async hasOpenDeal(leadId: string): Promise<boolean> {
    const deal = await prisma.deal.findFirst({
      where: { leadId, status: 'OPEN' },
      select: { id: true },
    });

    return deal !== null;
  }
}

/** O modelo às vezes devolve um id que não existe. Confere contra o catálogo. */
function validProductId(
  productId: string | null,
  products: readonly ProductSummary[],
): string | null {
  if (productId === null) return null;
  return products.some((p) => p.id === productId) ? productId : null;
}

function priceOf(
  productId: string | null,
  products: readonly ProductSummary[],
): number | null {
  if (productId === null) return null;
  return products.find((p) => p.id === productId)?.priceCents ?? null;
}

export type { LeadQualificationOutput };

export const leadService = new LeadService();
