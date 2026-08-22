import { NotFoundError, ValidationError } from '@/server/core/shared/errors';
import { UnauthorizedError } from '@/server/auth/errors';
import { prisma } from '@/server/db/prisma';
import type { ApprovalMode } from '../types';
import { audit } from './audit';

/**
 * Workspace: a fronteira de tenant do sistema.
 *
 * Toda consulta do Growth Engine é filtrada por `workspaceId`, e todo acesso
 * passa por `requireAccess`. Autorização só na rota não basta: um job, um
 * webhook e uma página de servidor chegam por caminhos diferentes e precisam
 * da mesma verificação.
 */
export class WorkspaceService {
  /** Workspace do usuário, criado na primeira vez que ele abre o painel. */
  async ensureForUser(userId: string, name = 'Meu negócio') {
    const existing = await prisma.workspace.findFirst({
      where: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
      orderBy: { createdAt: 'asc' },
    });

    if (existing) return existing;

    const slug = await this.uniqueSlug(name);

    const workspace = await prisma.workspace.create({
      data: {
        ownerId: userId,
        name,
        slug,
        // Padrão deliberado: nada vai ao ar sem um humano aprovar. Subir para
        // semiautomático é decisão consciente de quem já viu o agente operar.
        mode: 'MANUAL',
        members: { create: { userId, role: 'OWNER' } },
        brandProfile: { create: { name } },
      },
    });

    await audit({
      workspaceId: workspace.id,
      actorType: 'HUMAN',
      actor: userId,
      action: 'workspace.created',
      entityType: 'Workspace',
      entityId: workspace.id,
      mode: workspace.mode,
    });

    return workspace;
  }

  async requireAccess(workspaceId: string, userId: string) {
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
    });

    if (!workspace) {
      // 404 e 403 são a mesma resposta aqui de propósito: confirmar que um
      // workspace existe já é vazar informação para quem não tem acesso.
      throw new UnauthorizedError('Sem acesso a este workspace.');
    }

    return workspace;
  }

  /**
   * Resolve o workspace de uma requisição.
   *
   * Sem id explícito, usa o do usuário — o produto é single-workspace na
   * primeira versão, mas as rotas já falam a língua multi-tenant para que
   * virar SaaS não signifique reescrever cada rota.
   */
  async resolveForUser(userId: string, workspaceId?: string) {
    return workspaceId !== undefined && workspaceId !== ''
      ? this.requireAccess(workspaceId, userId)
      : this.ensureForUser(userId);
  }

  async setMode(workspaceId: string, userId: string, mode: ApprovalMode) {
    const workspace = await this.requireAccess(workspaceId, userId);

    const updated = await prisma.workspace.update({
      where: { id: workspaceId },
      data: { mode },
    });

    await audit({
      workspaceId,
      actorType: 'HUMAN',
      actor: userId,
      action: 'workspace.mode_changed',
      entityType: 'Workspace',
      entityId: workspaceId,
      mode: updated.mode,
      metadata: { from: workspace.mode, to: mode },
    });

    return updated;
  }

  async updateSettings(
    workspaceId: string,
    userId: string,
    input: {
      timezone?: string;
      quietHoursStart?: number;
      quietHoursEnd?: number;
      maxDailyCostUsd?: number;
      maxMessagesPerContactPerDay?: number;
      maxPublicationsPerDay?: number;
    },
  ) {
    await this.requireAccess(workspaceId, userId);

    return prisma.workspace.update({ where: { id: workspaceId }, data: input });
  }

  async upsertBrand(
    workspaceId: string,
    userId: string,
    input: {
      name: string;
      description?: string | null;
      toneOfVoice?: string;
      valueProposition?: string | null;
      doNotSay?: string[];
      guardrails?: string[];
      defaultCta?: string | null;
      language?: string;
    },
  ) {
    await this.requireAccess(workspaceId, userId);

    const data = {
      name: input.name,
      description: input.description ?? null,
      valueProposition: input.valueProposition ?? null,
      defaultCta: input.defaultCta ?? null,
      ...(input.toneOfVoice !== undefined
        ? { toneOfVoice: input.toneOfVoice }
        : {}),
      ...(input.language !== undefined ? { language: input.language } : {}),
      ...(input.doNotSay !== undefined ? { doNotSay: input.doNotSay } : {}),
      ...(input.guardrails !== undefined
        ? { guardrails: input.guardrails }
        : {}),
    };

    return prisma.brandProfile.upsert({
      where: { workspaceId },
      create: { workspaceId, ...data },
      update: data,
    });
  }

  async createProduct(
    workspaceId: string,
    userId: string,
    input: {
      name: string;
      description: string;
      priceCents?: number | null;
      currency?: string;
      checkoutUrl?: string | null;
      schedulingUrl?: string | null;
      benefits?: string[];
    },
  ) {
    await this.requireAccess(workspaceId, userId);

    // Link é o que o agente pode mandar para uma pessoa real: URL malformada
    // aqui vira mensagem quebrada lá.
    for (const url of [input.checkoutUrl, input.schedulingUrl]) {
      if (url !== undefined && url !== null && url !== '' && !isValidUrl(url)) {
        throw new ValidationError(`URL inválida: ${url}`);
      }
    }

    return prisma.product.create({
      data: {
        workspaceId,
        name: input.name,
        description: input.description,
        priceCents: input.priceCents ?? null,
        currency: input.currency ?? 'BRL',
        checkoutUrl: emptyToNull(input.checkoutUrl),
        schedulingUrl: emptyToNull(input.schedulingUrl),
        benefits: input.benefits ?? [],
      },
    });
  }

  async setProductActive(
    workspaceId: string,
    userId: string,
    productId: string,
    isActive: boolean,
  ) {
    await this.requireAccess(workspaceId, userId);

    const product = await prisma.product.findFirst({
      where: { id: productId, workspaceId },
    });

    if (!product) throw new NotFoundError('Produto', productId);

    return prisma.product.update({
      where: { id: productId },
      data: { isActive },
    });
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'workspace';

    for (let suffix = 0; suffix < 50; suffix++) {
      const candidate = suffix === 0 ? base : `${base}-${suffix}`;
      const taken = await prisma.workspace.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });

      if (!taken) return candidate;
    }

    return `${base}-${Date.now()}`;
  }
}

function emptyToNull(value: string | null | undefined): string | null {
  return value === undefined || value === null || value.trim() === ''
    ? null
    : value.trim();
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export const workspaceService = new WorkspaceService();
