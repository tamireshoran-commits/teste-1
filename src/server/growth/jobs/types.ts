/**
 * Catálogo de jobs.
 *
 * O sistema é assíncrono por natureza — um lead responde três horas depois, um
 * post é agendado para terça, um follow-up acontece em 48h. Nada disso cabe no
 * ciclo de uma requisição HTTP, então **a fila é requisito funcional**, não
 * otimização de desempenho.
 *
 * O payload é tipado por tipo de job para que o handler receba exatamente o
 * que o produtor enviou, sem `as` no meio do caminho.
 */

export const JOB_TYPES = [
  'strategy.research',
  'content.plan',
  'media.generate',
  'publish.execute',
  'metrics.collect',
  'inbound.process',
  'conversation.respond',
  'message.send',
  'followup.scan',
  'followup.send',
  'learning.analyze',
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export interface JobPayloadMap {
  /** Agente 1: pesquisa de mercado a partir do briefing. */
  'strategy.research': { workspaceId: string; strategyId: string };
  /** Agente 2: calendário editorial a partir da estratégia ativa. */
  'content.plan': { workspaceId: string; planId: string; pieceCount: number };
  /** Agente 3: briefing de vídeo + geração de mídia da peça. */
  'media.generate': { workspaceId: string; contentPieceId: string };
  /** Agente 4: publica uma peça já aprovada. */
  'publish.execute': { workspaceId: string; publicationId: string };
  /** Coleta de métricas de uma publicação (T+1h, T+24h, T+7d). */
  'metrics.collect': { workspaceId: string; publicationId: string };
  /** Processa um evento de webhook já persistido. */
  'inbound.process': { webhookEventId: string };
  /** Agente 6 responde uma conversa. Job próprio para poder ser reagendado
   *  (horário silencioso, limite diário) sem reprocessar o webhook. */
  'conversation.respond': { workspaceId: string; conversationId: string };
  /** Envia uma mensagem que já está aprovada e na fila. */
  'message.send': { workspaceId: string; messageId: string };
  /** Varre leads parados e agenda follow-ups. */
  'followup.scan': { workspaceId: string };
  /** Escreve e envia um follow-up agendado. */
  'followup.send': { workspaceId: string; followUpTaskId: string };
  /** Fecha o laço: métricas → padrões → próximo calendário. */
  'learning.analyze': { workspaceId: string; days: number };
}

export function isJobType(value: string): value is JobType {
  return (JOB_TYPES as readonly string[]).includes(value);
}
