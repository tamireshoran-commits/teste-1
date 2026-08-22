import type { ConversationChannel } from '../types';
import {
  hoursBetween,
  isQuietHour,
  nextAllowedInstant,
  startOfNextLocalDay,
  type QuietHours,
} from './time';

/**
 * Regras de plataforma e de bom senso para mensagens que saem do sistema.
 *
 * Esta é a camada que **nenhum modo de aprovação desliga**. O modo autônomo
 * decide se um humano precisa clicar em "enviar"; esta política decide se o
 * envio é permitido — pela Meta, pela lei e pelo respeito a quem está do outro
 * lado. Uma DM fora da janela de 24h não é "arriscada": ela é recusada pela
 * API e coloca o app em risco de revisão.
 *
 * Referência das regras implementadas (confirmar na documentação vigente antes
 * do go-live — a Meta muda esses limites):
 * - DM só dentro da janela de 24h desde a última mensagem da pessoa;
 * - resposta pública a comentário não tem janela;
 * - não existe API oficial para iniciar DM com quem nunca falou com a conta.
 */

export type MessageBlockCode =
  | 'OPT_OUT'
  | 'NO_INBOUND'
  | 'OUTSIDE_WINDOW'
  | 'QUIET_HOURS'
  | 'DAILY_LIMIT'
  | 'DUPLICATE_PENDING'
  | 'CONVERSATION_CLOSED';

export interface MessagingContext {
  now: Date;
  channel: ConversationChannel;
  /** Última mensagem recebida da pessoa. Null = nunca escreveu. */
  lastInboundAt: Date | null;
  contactOptOut: boolean;
  conversationClosed: boolean;
  /** Mensagens já enviadas a este contato no dia local. */
  messagesSentToday: number;
  maxMessagesPerContactPerDay: number;
  quietHours: QuietHours;
  timezone: string;
  windowHours: number;
  /** Já existe mensagem de saída aguardando envio/aprovação nesta conversa. */
  hasPendingOutbound: boolean;
}

export type MessagingDecision =
  | { allowed: true; reason: string }
  | {
      allowed: false;
      code: MessageBlockCode;
      reason: string;
      /**
       * Quando o bloqueio é temporário (silêncio, limite diário), diz quando
       * tentar de novo. Ausente = esperar não resolve; depende de a pessoa
       * responder ou de um humano assumir.
       */
      retryAt?: Date;
    };

const DM_CHANNELS: ReadonlySet<ConversationChannel> = new Set([
  'IG_DM',
  'FB_MESSENGER',
]);

export function isDirectMessageChannel(channel: ConversationChannel): boolean {
  return DM_CHANNELS.has(channel);
}

/**
 * Avalia se uma mensagem de saída pode ser enviada agora.
 *
 * A ordem das verificações importa: opt-out vem primeiro porque é o único
 * bloqueio que nunca expira, e responder "tente de novo mais tarde" a quem
 * pediu para parar seria exatamente o comportamento errado.
 */
export function evaluateOutboundMessage(
  ctx: MessagingContext,
): MessagingDecision {
  if (ctx.contactOptOut) {
    return {
      allowed: false,
      code: 'OPT_OUT',
      reason: 'O contato pediu para não receber mais mensagens.',
    };
  }

  if (ctx.conversationClosed) {
    return {
      allowed: false,
      code: 'CONVERSATION_CLOSED',
      reason: 'A conversa está encerrada.',
    };
  }

  if (ctx.hasPendingOutbound) {
    return {
      allowed: false,
      code: 'DUPLICATE_PENDING',
      reason:
        'Já existe uma mensagem aguardando envio nesta conversa; ' +
        'enviar outra duplicaria a resposta.',
    };
  }

  if (isDirectMessageChannel(ctx.channel)) {
    if (ctx.lastInboundAt === null) {
      return {
        allowed: false,
        code: 'NO_INBOUND',
        reason:
          'Não há mensagem recebida deste contato. Iniciar uma conversa por ' +
          'mensagem direta não é permitido pelas APIs oficiais.',
      };
    }

    const elapsed = hoursBetween(ctx.lastInboundAt, ctx.now);

    if (elapsed > ctx.windowHours) {
      return {
        allowed: false,
        code: 'OUTSIDE_WINDOW',
        reason:
          `A última mensagem do contato foi há ${Math.floor(elapsed)}h, fora ` +
          `da janela de ${ctx.windowHours}h permitida pela plataforma. ` +
          'É preciso que a pessoa responda, ou um humano assumir a conversa.',
      };
    }
  }

  if (ctx.messagesSentToday >= ctx.maxMessagesPerContactPerDay) {
    return {
      allowed: false,
      code: 'DAILY_LIMIT',
      reason:
        `Limite de ${ctx.maxMessagesPerContactPerDay} mensagens por dia para ` +
        'este contato já foi atingido.',
      retryAt: startOfNextLocalDay(ctx.now, ctx.timezone),
    };
  }

  // O silêncio vem por último de propósito: é o único bloqueio que se resolve
  // sozinho com o tempo, então só faz sentido agendar se todo o resto passou.
  if (isQuietHour(ctx.now, ctx.timezone, ctx.quietHours)) {
    return {
      allowed: false,
      code: 'QUIET_HOURS',
      reason: 'Horário silencioso do workspace.',
      retryAt: nextAllowedInstant(ctx.now, ctx.timezone, ctx.quietHours),
    };
  }

  return { allowed: true, reason: 'Envio permitido.' };
}

/**
 * Resposta pública a comentário.
 *
 * Não tem janela de 24h, mas continua respeitando opt-out e horário
 * silencioso — responder às 3h da manhã é sinal de robô, e é o tipo de coisa
 * que faz a audiência perceber que não há ninguém ali.
 */
export function evaluateCommentReply(
  ctx: Pick<
    MessagingContext,
    'now' | 'contactOptOut' | 'quietHours' | 'timezone' | 'hasPendingOutbound'
  >,
): MessagingDecision {
  if (ctx.contactOptOut) {
    return {
      allowed: false,
      code: 'OPT_OUT',
      reason: 'O contato pediu para não ser mais abordado.',
    };
  }

  if (ctx.hasPendingOutbound) {
    return {
      allowed: false,
      code: 'DUPLICATE_PENDING',
      reason: 'Já existe uma resposta pendente para este comentário.',
    };
  }

  if (isQuietHour(ctx.now, ctx.timezone, ctx.quietHours)) {
    return {
      allowed: false,
      code: 'QUIET_HOURS',
      reason: 'Horário silencioso do workspace.',
      retryAt: nextAllowedInstant(ctx.now, ctx.timezone, ctx.quietHours),
    };
  }

  return { allowed: true, reason: 'Resposta a comentário permitida.' };
}

/**
 * Pedido de descadastro em linguagem natural.
 *
 * Ninguém digita "opt-out": as pessoas escrevem "para de me mandar mensagem".
 * Detectar isso e parar na hora é obrigação legal e, antes disso, o mínimo de
 * respeito por quem está do outro lado. Na dúvida, o custo de parar é muito
 * menor que o de insistir.
 */
const OPT_OUT_PATTERNS: readonly RegExp[] = [
  /\bn[ãa]o\s+(?:quero|desejo)\s+(?:mais|receber)/i,
  /\b(?:para|pare|parem|pra)\s+de\s+(?:me\s+)?(?:mandar|enviar)/i,
  /\bme\s+(?:tira|remove|descadastr\w*)/i,
  /\bdescadastr\w+/i,
  /\bsair\s+da\s+lista\b/i,
  /\bn[ãa]o\s+me\s+chame?\s+mais\b/i,
  /^\s*(?:stop|sair|cancelar)\s*$/i,
];

export function isOptOutRequest(text: string): boolean {
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Espera antes do próximo follow-up.
 *
 * Cresce a cada tentativa (2 dias, 5 dias, 10 dias): quem não respondeu duas
 * vezes não vai responder ao terceiro toque no dia seguinte, e insistir é o
 * caminho mais curto para o botão de denúncia.
 */
export function followUpDelayMs(attempt: number): number {
  const days = [2, 5, 10];
  const index = Math.min(Math.max(attempt, 1), days.length) - 1;
  return (days[index] ?? 10) * 24 * 60 * 60 * 1000;
}
