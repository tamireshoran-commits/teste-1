import { NotFoundError, ValidationError } from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';
import { prisma } from '@/server/db/prisma';
import {
  runVideoCreator,
  validateSceneDurations,
} from '../agents/videoCreator';
import { decideApproval } from '../policy/approvalPolicy';
import {
  getImageProvider,
  getSpeechProvider,
  getVideoProvider,
} from '../providers/registry';
import type { GeneratedMedia } from '../providers/media/MediaProvider';
import { agentDeps, loadWorkspaceContext } from './context';
import { approvalService } from './ApprovalService';
import { audit } from './audit';
import { publishingService } from './PublishingService';

const log = logger.child('growth-media');

/**
 * Agente 3 na camada de aplicação: do roteiro aprovado à mídia.
 *
 * Esta é a etapa que **gasta dinheiro de verdade** — geração de imagem e vídeo
 * é o item mais caro da operação. Por isso ela é a única ação de risco médio
 * do sistema: no modo manual, um humano autoriza antes de a fatura correr.
 */
export class MediaService {
  async generateForPiece(contentPieceId: string, jobId?: string) {
    const piece = await prisma.contentPiece.findUnique({
      where: { id: contentPieceId },
      include: { media: true },
    });

    if (!piece) throw new NotFoundError('Conteúdo', contentPieceId);

    if (piece.status !== 'APPROVED' && piece.status !== 'SCHEDULED') {
      throw new ValidationError(
        `A peça precisa estar aprovada para gerar mídia (status atual: ${piece.status}).`,
      );
    }

    if (piece.media.some((asset) => asset.status === 'READY')) {
      log.info('mídia já gerada; nada a fazer', { contentPieceId });
      return { skipped: true as const };
    }

    const context = await loadWorkspaceContext(piece.workspaceId);
    const decision = decideApproval('MEDIA_GENERATE', context.settings.mode);

    if (decision.requiresApproval) {
      const authorized = await approvalService.hasApproval(
        'MEDIA_GENERATE',
        'ContentPiece',
        contentPieceId,
      );

      if (!authorized) {
        await approvalService.request({
          workspaceId: piece.workspaceId,
          actionType: 'MEDIA_GENERATE',
          entityType: 'ContentPiece',
          entityId: contentPieceId,
          title: `Gerar mídia: ${piece.theme}`,
          payload: {
            format: piece.format,
            hook: piece.hook,
            script: piece.script,
          },
          requestedByAgent: 'VIDEO_CREATOR',
        });

        return { pendingApproval: true as const };
      }
    }

    const isVideo = piece.format === 'REEL' || piece.format === 'STORY';
    const keyPrefix = `growth/${piece.workspaceId}/${piece.id}`;

    const assets: GeneratedMedia[] = [];

    if (isVideo) {
      const { data: brief } = await runVideoCreator(
        {
          brand: context.brand,
          format: piece.format,
          theme: piece.theme,
          hook: piece.hook,
          script: piece.script,
          caption: piece.caption,
          cta: piece.cta,
        },
        agentDeps(piece.workspaceId, {
          ...(jobId !== undefined ? { jobId } : {}),
        }),
      );

      const durations = validateSceneDurations(brief);

      if (!durations.ok) {
        log.warn('duração das cenas inconsistente', {
          contentPieceId,
          message: durations.message,
        });
      }

      const video = await getVideoProvider().generateVideo({
        scenes: brief.scenes,
        aspectRatio: brief.aspectRatio,
        totalDurationSec: brief.totalDurationSec,
        keyPrefix,
      });

      const narration = await getSpeechProvider().generateSpeech({
        text: brief.narrationScript,
        language: context.brand.language,
        keyPrefix,
      });

      const thumbnail = await getImageProvider().generateImage({
        prompt: brief.thumbnailPrompt || `${piece.theme}. ${piece.hook}`,
        aspectRatio: '9:16',
        keyPrefix,
      });

      assets.push(video, narration, { ...thumbnail, kind: 'THUMBNAIL' });

      await prisma.mediaAsset.create({
        data: {
          contentPieceId,
          kind: 'CAPTIONS',
          status: 'READY',
          provider: 'growth',
          text: brief.captions
            .map((caption) => `${caption.startSec}-${caption.endSec}: ${caption.text}`)
            .join('\n'),
          meta: { hashtags: brief.hashtags, musicMood: brief.musicMood },
        },
      });
    } else {
      const image = await getImageProvider().generateImage({
        prompt: `${piece.theme}. ${piece.hook}. Estilo alinhado a: ${context.brand.toneOfVoice}`,
        aspectRatio: piece.format === 'CAROUSEL' ? '1:1' : '9:16',
        keyPrefix,
      });

      assets.push(image);
    }

    for (const asset of assets) {
      await prisma.mediaAsset.create({
        data: {
          contentPieceId,
          kind: asset.kind,
          status: 'READY',
          provider: asset.provider,
          model: asset.model,
          storageKey: asset.storageKey,
          externalUrl: asset.externalUrl,
          durationSec: asset.durationSec,
          costUsd: asset.costUsd,
          isMock: asset.isMock,
          meta: (asset.meta ?? {}) as object,
        },
      });
    }

    await audit({
      workspaceId: piece.workspaceId,
      actorType: 'AGENT',
      actor: 'VIDEO_CREATOR',
      action: 'media.generated',
      entityType: 'ContentPiece',
      entityId: contentPieceId,
      mode: context.settings.mode,
      metadata: { assets: assets.length, isVideo },
    });

    // Mídia pronta é o gatilho da publicação: sem arquivo, o Instagram recusa.
    await publishingService.schedule(contentPieceId);

    return { assets: assets.length, skipped: false as const };
  }
}

export const mediaService = new MediaService();
