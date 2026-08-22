import { hostname } from 'node:os';
import { z } from 'zod';
import { env } from '@/server/config/env';
import { ValidationError } from '@/server/core/shared/errors';
import { contentService } from '../services/ContentService';
import { followUpService } from '../services/FollowUpService';
import { inboundService } from '../services/InboundService';
import { learningService } from '../services/LearningService';
import { mediaService } from '../services/MediaService';
import { publishingService } from '../services/PublishingService';
import { salesService } from '../services/SalesService';
import { strategyService } from '../services/StrategyService';
import { growthQueue } from './queue';
import { runWorkerTick, type JobHandlerMap, type WorkerResult } from './worker';

/**
 * Ligação entre tipo de job e serviço.
 *
 * O payload chega do banco como `unknown` — foi gravado por outra execução,
 * possivelmente por uma versão anterior do código. Validar com Zod aqui evita
 * que um payload antigo derrube o worker com `undefined is not a function` no
 * meio do processamento.
 */

const workspaceJob = z.object({ workspaceId: z.string().min(1) });

const schemas = {
  'strategy.research': workspaceJob.extend({ strategyId: z.string().min(1) }),
  'content.plan': workspaceJob.extend({
    planId: z.string().min(1),
    pieceCount: z.number().int().min(1).max(30).default(12),
  }),
  'media.generate': workspaceJob.extend({ contentPieceId: z.string().min(1) }),
  'publish.execute': workspaceJob.extend({ publicationId: z.string().min(1) }),
  'metrics.collect': workspaceJob.extend({ publicationId: z.string().min(1) }),
  'inbound.process': z.object({ webhookEventId: z.string().min(1) }),
  'conversation.respond': workspaceJob.extend({
    conversationId: z.string().min(1),
  }),
  'message.send': workspaceJob.extend({ messageId: z.string().min(1) }),
  'followup.scan': workspaceJob,
  'followup.send': workspaceJob.extend({ followUpTaskId: z.string().min(1) }),
  'learning.analyze': workspaceJob.extend({
    days: z.number().int().min(1).max(365).default(30),
  }),
} as const;

function parse<T extends keyof typeof schemas>(
  type: T,
  payload: unknown,
): z.infer<(typeof schemas)[T]> {
  const result = schemas[type].safeParse(payload);

  if (!result.success) {
    throw new ValidationError(
      `Payload inválido para o job "${type}": ` +
        result.error.issues.map((i) => i.path.join('.')).join(', '),
    );
  }

  return result.data as z.infer<(typeof schemas)[T]>;
}

export const growthHandlers: JobHandlerMap = {
  'strategy.research': async (payload, ctx) => {
    const input = parse('strategy.research', payload);
    return strategyService.run(input.strategyId, ctx.jobId);
  },

  'content.plan': async (payload, ctx) => {
    const input = parse('content.plan', payload);
    return contentService.runPlan(input.planId, input.pieceCount, ctx.jobId);
  },

  'media.generate': async (payload, ctx) => {
    const input = parse('media.generate', payload);
    return mediaService.generateForPiece(input.contentPieceId, ctx.jobId);
  },

  'publish.execute': async (payload) => {
    const input = parse('publish.execute', payload);
    return publishingService.execute(input.publicationId);
  },

  'metrics.collect': async (payload) => {
    const input = parse('metrics.collect', payload);
    return publishingService.collectMetrics(input.publicationId);
  },

  'inbound.process': async (payload, ctx) => {
    const input = parse('inbound.process', payload);
    return inboundService.process(input.webhookEventId, ctx.jobId);
  },

  'conversation.respond': async (payload, ctx) => {
    const input = parse('conversation.respond', payload);
    return salesService.respond(input.conversationId, ctx.jobId);
  },

  'message.send': async (payload) => {
    const input = parse('message.send', payload);
    return salesService.send(input.messageId);
  },

  'followup.scan': async (payload) => {
    const input = parse('followup.scan', payload);
    return followUpService.scan(input.workspaceId);
  },

  'followup.send': async (payload, ctx) => {
    const input = parse('followup.send', payload);
    return followUpService.send(input.followUpTaskId, ctx.jobId);
  },

  'learning.analyze': async (payload, ctx) => {
    const input = parse('learning.analyze', payload);
    return learningService.analyze(input.workspaceId, input.days, ctx.jobId);
  },
};

/**
 * Um ciclo do worker.
 *
 * Chamado em laço por um processo dedicado, ou por um cron HTTP em ambiente
 * serverless (`POST /api/growth/worker/tick`). O `workerId` identifica quem
 * travou cada job — essencial para depurar fila presa com mais de um worker.
 */
export function runGrowthWorkerTick(): Promise<WorkerResult> {
  return runWorkerTick({
    queue: growthQueue,
    handlers: growthHandlers,
    batchSize: env.GROWTH_WORKER_BATCH_SIZE,
    workerId: `${hostname()}:${process.pid}`,
    lockTimeoutMs: env.GROWTH_JOB_LOCK_TIMEOUT_MS,
  });
}
