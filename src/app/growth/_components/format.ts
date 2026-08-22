/** Formatação compartilhada pelas páginas do painel. */

export function formatCurrency(cents: number, currency = 'BRL'): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(
    cents / 100,
  );
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date);
}

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho',
  PENDING_APPROVAL: 'Aguardando aprovação',
  APPROVED: 'Aprovado',
  REJECTED: 'Reprovado',
  SCHEDULED: 'Agendado',
  PUBLISHED: 'Publicado',
  FAILED: 'Falhou',
  QUEUED: 'Na fila',
  PUBLISHING: 'Publicando',
  CANCELLED: 'Cancelado',
  OPEN: 'Aberta',
  WAITING_CUSTOMER: 'Aguardando cliente',
  WAITING_HUMAN: 'Precisa de humano',
  HUMAN_HANDLED: 'Com humano',
  CLOSED: 'Encerrada',
  SENT: 'Enviada',
  BLOCKED: 'Bloqueada',
  RECEIVED: 'Recebida',
};

export const TEMPERATURE_LABEL: Record<string, string> = {
  COLD: 'Frio',
  WARM: 'Morno',
  HOT: 'Quente',
  READY: 'Pronto para compra',
};

export const TEMPERATURE_TONE: Record<string, string> = {
  COLD: 'bg-ink-100 text-ink-700',
  WARM: 'bg-amber-100 text-amber-800',
  HOT: 'bg-orange-100 text-orange-800',
  READY: 'bg-emerald-100 text-emerald-800',
};

export const CHANNEL_LABEL: Record<string, string> = {
  IG_DM: 'Instagram · direct',
  IG_COMMENT: 'Instagram · comentário',
  FB_MESSENGER: 'Facebook · Messenger',
  FB_COMMENT: 'Facebook · comentário',
};
