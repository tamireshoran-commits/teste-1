import { logger } from '@/server/core/shared/logger';
import { prisma } from '@/server/db/prisma';
import type { ApprovalMode } from '../types';

const log = logger.child('growth-audit');

/**
 * Registro de ação com efeito externo.
 *
 * Guarda **em que modo** a ação aconteceu, e não só quem a fez: quando alguém
 * perguntar "por que essa DM saiu sem eu aprovar", a resposta precisa estar no
 * banco, não na memória de quem mexeu na configuração.
 *
 * Falha de auditoria não derruba a operação — mas vira log de erro, porque um
 * rastro com buraco é pior que nenhum.
 */
export async function audit(input: {
  workspaceId: string;
  actorType: 'AGENT' | 'HUMAN' | 'SYSTEM';
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  mode: ApprovalMode;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        workspaceId: input.workspaceId,
        actorType: input.actorType,
        actor: input.actor,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        mode: input.mode,
        metadata: (input.metadata ?? {}) as object,
      },
    });
  } catch (error) {
    log.error('falha ao gravar auditoria', { error, action: input.action });
  }
}
