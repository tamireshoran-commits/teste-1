import { logger } from '@/server/core/shared/logger';
import type { AIUsageEntry, AIUsageRecorder } from '@/server/core/shared/usage';
import type { Db } from './prisma';

const log = logger.child('ai-usage');

/** Só os delegates que esta classe usa — ver a nota em PrismaCacheStore. */
export type UsageDb = Pick<Db, 'aIUsageLog' | 'analysis'>;

/**
 * Grava o uso de IA em `ai_usage_logs` e acumula o custo estimado na análise.
 *
 * Registra **também as chamadas que falharam**: uma tentativa que estourou
 * timeout depois de consumir tokens de entrada custou dinheiro, e omiti-la
 * subestimaria o gasto real.
 *
 * Como no cache, falha de registro não derruba a análise — perder uma linha de
 * telemetria é menos grave que perder o resultado que o usuário está esperando.
 */
export class PrismaUsageRecorder implements AIUsageRecorder {
  constructor(private readonly db: UsageDb) {}

  async record(entry: AIUsageEntry): Promise<void> {
    try {
      await this.db.aIUsageLog.create({
        data: {
          analysisId: entry.analysisId ?? null,
          workspaceId: entry.workspaceId ?? null,
          provider: entry.provider,
          model: entry.model,
          operation: entry.operation,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          imageCount: entry.imageCount,
          estimatedCostUsd: entry.estimatedCostUsd,
          latencyMs: entry.latencyMs ?? null,
          success: entry.success,
          errorCode: entry.errorCode ?? null,
        },
      });

      if (entry.analysisId && entry.estimatedCostUsd > 0) {
        await this.db.analysis.update({
          where: { id: entry.analysisId },
          data: {
            estimatedCostUsd: { increment: entry.estimatedCostUsd },
          },
        });
      }
    } catch (error) {
      log.warn('falha ao registrar uso de IA', { error, entry });
    }
  }
}
