import { env } from '@/server/config/env';
import { NotFoundError, ValidationError } from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';
import { prisma } from '@/server/db/prisma';
import { growthQueue } from '../jobs/queue';
import { decideApproval } from '../policy/approvalPolicy';
import { localDayKey } from '../policy/time';
import {
  getSocialPublisher,
} from '../providers/registry';
import type { SocialAccountRef } from '../providers/social/SocialProvider';
import { resolveAccessToken } from '../providers/social/tokens';
import { approvalService } from './ApprovalService';
import { audit } from './audit';
import { loadWorkspaceContext } from './context';
import { workspaceService } from './WorkspaceService';

const log = logger.child('growth-publishing');

/** Coletas de métrica após a publicação: curva, não só número final. */
const METRIC_COLLECTIONS_MS = [
  60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
];

/**
 * Agente 4: fila de publicação.
 *
 * Publicar é a ação mais irreversível do sistema, e por isso ela é sempre de
 * risco alto — só o modo autônomo dispensa o clique humano. Mesmo lá, a cota
 * diária da plataforma continua valendo: estourar o limite da Meta derruba a
 * conta, e nenhum modo de operação pode autorizar isso.
 */
export class PublishingService {
  /**
   * Cria as publicações de uma peça com mídia pronta, uma por conta conectada.
   */
  async schedule(contentPieceId: string) {
    const piece = await prisma.contentPiece.findUnique({
      where: { id: contentPieceId },
      include: { workspace: true, media: true },
    });

    if (!piece) throw new NotFoundError('Conteúdo', contentPieceId);

    const targets = asPlatformList(piece.targets);

    const accounts = await prisma.socialAccount.findMany({
      where: {
        workspaceId: piece.workspaceId,
        platform: { in: targets },
        status: { in: ['CONNECTED', 'MOCK'] },
      },
    });

    if (accounts.length === 0) {
      log.warn('nenhuma conta conectada para publicar', {
        contentPieceId,
        targets,
      });

      return { publications: 0, reason: 'sem-conta-conectada' as const };
    }

    const decision = decideApproval('CONTENT_PUBLISH', piece.workspace.mode);
    const created: string[] = [];

    for (const account of accounts) {
      const publication = await prisma.publication.upsert({
        where: {
          contentPieceId_socialAccountId: {
            contentPieceId,
            socialAccountId: account.id,
          },
        },
        create: {
          workspaceId: piece.workspaceId,
          contentPieceId,
          socialAccountId: account.id,
          platform: account.platform,
          status: decision.requiresApproval ? 'PENDING_APPROVAL' : 'SCHEDULED',
          scheduledFor: piece.scheduledFor,
        },
        update: {},
      });

      created.push(publication.id);

      if (decision.requiresApproval) {
        await approvalService.request({
          workspaceId: piece.workspaceId,
          actionType: 'CONTENT_PUBLISH',
          entityType: 'Publication',
          entityId: publication.id,
          title: `Publicar em ${account.platform}: ${piece.theme}`,
          payload: {
            caption: piece.caption,
            format: piece.format,
            scheduledFor: piece.scheduledFor?.toISOString() ?? null,
            account: account.username ?? account.externalId,
          },
          requestedByAgent: 'SOCIAL_MANAGER',
        });
      } else {
        await growthQueue.enqueue(
          'publish.execute',
          { workspaceId: piece.workspaceId, publicationId: publication.id },
          {
            workspaceId: piece.workspaceId,
            runAt: piece.scheduledFor ?? new Date(),
            dedupeKey: `publish.execute:${publication.id}`,
          },
        );
      }
    }

    await prisma.contentPiece.update({
      where: { id: contentPieceId },
      data: { status: 'SCHEDULED' },
    });

    return {
      publications: created.length,
      requiresApproval: decision.requiresApproval,
    };
  }

  /** Executado pelo worker. */
  async execute(publicationId: string) {
    const publication = await prisma.publication.findUnique({
      where: { id: publicationId },
      include: {
        contentPiece: { include: { media: true } },
        socialAccount: true,
        workspace: true,
      },
    });

    if (!publication) throw new NotFoundError('Publicação', publicationId);

    if (publication.status === 'PUBLISHED') {
      return { alreadyPublished: true as const };
    }

    if (publication.status === 'PENDING_APPROVAL') {
      throw new ValidationError('Esta publicação ainda aguarda aprovação.');
    }

    const withinQuota = await this.checkDailyQuota(
      publication.workspaceId,
      publication.workspace.timezone,
      publication.workspace.maxPublicationsPerDay,
    );

    if (!withinQuota.ok) {
      // Reagenda em vez de falhar: o conteúdo continua válido amanhã, e
      // insistir hoje só gastaria tentativa contra um limite de plataforma.
      await growthQueue.enqueue(
        'publish.execute',
        { workspaceId: publication.workspaceId, publicationId },
        {
          workspaceId: publication.workspaceId,
          runAt: withinQuota.retryAt,
          dedupeKey: `publish.execute:${publicationId}:${localDayKey(withinQuota.retryAt, publication.workspace.timezone)}`,
        },
      );

      log.warn('cota diária de publicações atingida; reagendado', {
        publicationId,
        retryAt: withinQuota.retryAt,
      });

      return { rescheduled: true as const };
    }

    await prisma.publication.update({
      where: { id: publicationId },
      data: { status: 'PUBLISHING', attempts: { increment: 1 } },
    });

    const account = toAccountRef(publication.socialAccount);
    const media = pickMedia(publication.contentPiece.media);

    try {
      const result = await getSocialPublisher().publish({
        account,
        format: publication.contentPiece.format,
        caption: publication.contentPiece.caption,
        mediaUrl: media.url,
        mediaKind: media.kind,
      });

      const published = await prisma.publication.update({
        where: { id: publicationId },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          externalPostId: result.externalPostId,
          permalink: result.permalink,
          isMock: result.isMock,
          errorMessage: null,
        },
      });

      await prisma.contentPiece.update({
        where: { id: publication.contentPieceId },
        data: { status: 'PUBLISHED' },
      });

      for (const delayMs of METRIC_COLLECTIONS_MS) {
        await growthQueue.enqueue(
          'metrics.collect',
          { workspaceId: publication.workspaceId, publicationId },
          {
            workspaceId: publication.workspaceId,
            runAt: new Date(Date.now() + delayMs),
            dedupeKey: `metrics.collect:${publicationId}:${delayMs}`,
          },
        );
      }

      await audit({
        workspaceId: publication.workspaceId,
        actorType: 'AGENT',
        actor: 'SOCIAL_MANAGER',
        action: 'content.published',
        entityType: 'Publication',
        entityId: publicationId,
        mode: publication.workspace.mode,
        metadata: {
          platform: publication.platform,
          externalPostId: result.externalPostId,
          isMock: result.isMock,
        },
      });

      return { published, isMock: result.isMock };
    } catch (error) {
      await prisma.publication.update({
        where: { id: publicationId },
        data: {
          status: 'FAILED',
          errorMessage:
            error instanceof Error ? error.message.slice(0, 500) : String(error),
        },
      });

      throw error;
    }
  }

  /** Executado pelo worker, nas janelas de coleta. */
  async collectMetrics(publicationId: string) {
    const publication = await prisma.publication.findUnique({
      where: { id: publicationId },
      include: { socialAccount: true },
    });

    if (!publication) throw new NotFoundError('Publicação', publicationId);

    if (publication.externalPostId === null) {
      throw new ValidationError('Publicação sem id externo; nada a coletar.');
    }

    const snapshot = await getSocialPublisher().fetchMetrics({
      account: toAccountRef(publication.socialAccount),
      externalPostId: publication.externalPostId,
    });

    return prisma.contentMetric.create({
      data: {
        publicationId,
        impressions: snapshot.impressions,
        reach: snapshot.reach,
        likes: snapshot.likes,
        comments: snapshot.comments,
        shares: snapshot.shares,
        saves: snapshot.saves,
        videoViews: snapshot.videoViews,
        linkClicks: snapshot.linkClicks,
        profileVisits: snapshot.profileVisits,
        raw: snapshot.raw as object,
        isMock: snapshot.isMock,
      },
    });
  }

  async connectAccount(
    workspaceId: string,
    userId: string,
    input: {
      platform: 'INSTAGRAM' | 'FACEBOOK';
      externalId: string;
      username?: string;
      pageId?: string;
      tokenRef?: string;
    },
  ) {
    await workspaceService.requireAccess(workspaceId, userId);

    const context = await loadWorkspaceContext(workspaceId);
    const hasToken = resolveAccessToken(input.tokenRef ?? null) !== null;

    const account = await prisma.socialAccount.upsert({
      where: {
        workspaceId_platform_externalId: {
          workspaceId,
          platform: input.platform,
          externalId: input.externalId,
        },
      },
      create: {
        workspaceId,
        platform: input.platform,
        externalId: input.externalId,
        username: input.username ?? null,
        pageId: input.pageId ?? null,
        tokenRef: input.tokenRef ?? null,
        // Sem token, a conta existe mas opera simulada — e a interface avisa.
        status: hasToken && env.SOCIAL_PROVIDER === 'META' ? 'CONNECTED' : 'MOCK',
      },
      update: {
        username: input.username ?? null,
        pageId: input.pageId ?? null,
        tokenRef: input.tokenRef ?? null,
        status: hasToken && env.SOCIAL_PROVIDER === 'META' ? 'CONNECTED' : 'MOCK',
        lastCheckedAt: new Date(),
      },
    });

    await audit({
      workspaceId,
      actorType: 'HUMAN',
      actor: userId,
      action: 'social_account.connected',
      entityType: 'SocialAccount',
      entityId: account.id,
      mode: context.settings.mode,
      metadata: { platform: input.platform, status: account.status },
    });

    return account;
  }

  private async checkDailyQuota(
    workspaceId: string,
    timezone: string,
    limit: number,
  ): Promise<{ ok: true } | { ok: false; retryAt: Date }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const published = await prisma.publication.count({
      where: {
        workspaceId,
        status: 'PUBLISHED',
        publishedAt: { gte: since },
      },
    });

    if (published < limit) return { ok: true };

    const oldest = await prisma.publication.findFirst({
      where: { workspaceId, status: 'PUBLISHED', publishedAt: { gte: since } },
      orderBy: { publishedAt: 'asc' },
      select: { publishedAt: true },
    });

    // A janela é deslizante: liberar assim que a publicação mais antiga sair
    // dela é mais preciso do que esperar a virada do dia.
    const retryAt =
      oldest?.publishedAt !== null && oldest?.publishedAt !== undefined
        ? new Date(oldest.publishedAt.getTime() + 24 * 60 * 60 * 1000 + 60_000)
        : new Date(Date.now() + 60 * 60 * 1000);

    log.debug('cota diária atingida', { workspaceId, timezone, limit });

    return { ok: false, retryAt };
  }
}

function toAccountRef(account: {
  platform: 'INSTAGRAM' | 'FACEBOOK';
  externalId: string;
  pageId: string | null;
  tokenRef: string | null;
}): SocialAccountRef {
  return {
    platform: account.platform,
    externalId: account.externalId,
    pageId: account.pageId,
    accessToken: resolveAccessToken(account.tokenRef),
  };
}

/**
 * Escolhe a mídia da publicação.
 *
 * Vídeo tem prioridade sobre imagem: se a peça é um Reels, publicar a
 * thumbnail como post estático seria pior do que não publicar.
 */
function pickMedia(
  media: ReadonlyArray<{
    kind: string;
    status: string;
    storageKey: string | null;
    externalUrl: string | null;
  }>,
): { kind: 'IMAGE' | 'VIDEO' | 'NONE'; url: string | null } {
  const ready = media.filter((asset) => asset.status === 'READY');

  const video = ready.find((asset) => asset.kind === 'VIDEO');
  if (video) return { kind: 'VIDEO', url: mediaUrl(video) };

  const image = ready.find(
    (asset) => asset.kind === 'IMAGE' || asset.kind === 'THUMBNAIL',
  );
  if (image) return { kind: 'IMAGE', url: mediaUrl(image) };

  return { kind: 'NONE', url: null };
}

function mediaUrl(asset: {
  storageKey: string | null;
  externalUrl: string | null;
}): string | null {
  if (asset.externalUrl !== null) return asset.externalUrl;
  if (asset.storageKey === null) return null;

  // A Meta baixa o arquivo por URL pública: o endpoint precisa responder sem
  // autenticação e com o content-type correto.
  return `${env.AUTH_URL.replace(/\/$/, '')}/api/growth/media/${encodeURIComponent(asset.storageKey)}`;
}

function asPlatformList(value: unknown): Array<'INSTAGRAM' | 'FACEBOOK'> {
  const list = Array.isArray(value) ? value : [];

  const platforms = list.filter(
    (item): item is 'INSTAGRAM' | 'FACEBOOK' =>
      item === 'INSTAGRAM' || item === 'FACEBOOK',
  );

  return platforms.length > 0 ? platforms : ['INSTAGRAM'];
}

export const publishingService = new PublishingService();
