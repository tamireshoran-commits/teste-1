import { describe, expect, it } from 'vitest';
import {
  evaluateCommentReply,
  evaluateOutboundMessage,
  followUpDelayMs,
  isOptOutRequest,
  type MessagingContext,
} from '@/server/growth/policy/messagingPolicy';

const NOW = new Date('2026-03-11T17:00:00Z'); // 14h em São Paulo

function context(overrides: Partial<MessagingContext> = {}): MessagingContext {
  return {
    now: NOW,
    channel: 'IG_DM',
    lastInboundAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    contactOptOut: false,
    conversationClosed: false,
    messagesSentToday: 0,
    maxMessagesPerContactPerDay: 3,
    quietHours: { start: 21, end: 8 },
    timezone: 'America/Sao_Paulo',
    windowHours: 24,
    hasPendingOutbound: false,
    ...overrides,
  };
}

describe('política de mensagens', () => {
  it('permite responder dentro da janela', () => {
    expect(evaluateOutboundMessage(context()).allowed).toBe(true);
  });

  it('bloqueia para sempre quem pediu para não receber mensagens', () => {
    const decision = evaluateOutboundMessage(context({ contactOptOut: true }));

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;

    expect(decision.code).toBe('OPT_OUT');
    // Opt-out não tem "tente de novo mais tarde".
    expect(decision.retryAt).toBeUndefined();
  });

  it('não inicia conversa por mensagem direta com quem nunca escreveu', () => {
    const decision = evaluateOutboundMessage(context({ lastInboundAt: null }));

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;

    expect(decision.code).toBe('NO_INBOUND');
    expect(decision.reason).toMatch(/não é permitido pelas APIs oficiais/);
  });

  it('bloqueia fora da janela de 24h', () => {
    const decision = evaluateOutboundMessage(
      context({
        lastInboundAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000),
      }),
    );

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;

    expect(decision.code).toBe('OUTSIDE_WINDOW');
    // Esperar não resolve: depende de a pessoa escrever de novo.
    expect(decision.retryAt).toBeUndefined();
  });

  it('adia no horário silencioso em vez de bloquear', () => {
    const madrugada = new Date('2026-03-11T05:00:00Z'); // 2h em São Paulo

    const decision = evaluateOutboundMessage(
      context({
        now: madrugada,
        lastInboundAt: new Date(madrugada.getTime() - 60 * 60 * 1000),
      }),
    );

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;

    expect(decision.code).toBe('QUIET_HOURS');
    expect(decision.retryAt).toBeInstanceOf(Date);
  });

  it('respeita o limite diário por contato, com retomada no dia seguinte', () => {
    const decision = evaluateOutboundMessage(
      context({ messagesSentToday: 3, maxMessagesPerContactPerDay: 3 }),
    );

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;

    expect(decision.code).toBe('DAILY_LIMIT');
    expect(decision.retryAt?.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('não envia duas respostas para a mesma conversa', () => {
    const decision = evaluateOutboundMessage(
      context({ hasPendingOutbound: true }),
    );

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.code).toBe('DUPLICATE_PENDING');
  });

  it('resposta a comentário não tem janela de 24h', () => {
    const decision = evaluateCommentReply({
      now: NOW,
      contactOptOut: false,
      quietHours: { start: 21, end: 8 },
      timezone: 'America/Sao_Paulo',
      hasPendingOutbound: false,
    });

    expect(decision.allowed).toBe(true);
  });

  it('resposta a comentário continua respeitando opt-out', () => {
    const decision = evaluateCommentReply({
      now: NOW,
      contactOptOut: true,
      quietHours: { start: 21, end: 8 },
      timezone: 'America/Sao_Paulo',
      hasPendingOutbound: false,
    });

    expect(decision.allowed).toBe(false);
  });

  it('o intervalo entre follow-ups cresce a cada tentativa', () => {
    const dia = 24 * 60 * 60 * 1000;

    expect(followUpDelayMs(1)).toBe(2 * dia);
    expect(followUpDelayMs(2)).toBe(5 * dia);
    expect(followUpDelayMs(3)).toBe(10 * dia);
    // Além do limite, mantém o maior intervalo em vez de zerar.
    expect(followUpDelayMs(9)).toBe(10 * dia);
  });

  it('reconhece pedido de descadastro em linguagem natural', () => {
    const pedidos = [
      'para de me mandar mensagem',
      'não quero mais receber nada',
      'me remove dessa lista',
      'quero sair da lista',
      'STOP',
    ];

    for (const texto of pedidos) {
      expect(isOptOutRequest(texto), texto).toBe(true);
    }

    expect(isOptOutRequest('quanto custa? não quero perder tempo')).toBe(false);
  });
});
