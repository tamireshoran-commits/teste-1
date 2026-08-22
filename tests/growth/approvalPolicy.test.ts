import { describe, expect, it } from 'vitest';
import {
  ACTION_RISK,
  decideApproval,
} from '@/server/growth/policy/approvalPolicy';
import type { ApprovalMode, GrowthAction } from '@/server/growth/types';

const ALL_ACTIONS = Object.keys(ACTION_RISK) as GrowthAction[];

describe('política de aprovação', () => {
  it('no modo manual, só ação de risco baixo é automática', () => {
    for (const action of ALL_ACTIONS) {
      const decision = decideApproval(action, 'MANUAL');

      expect(decision.requiresApproval).toBe(ACTION_RISK[action] !== 'LOW');
    }
  });

  it('no modo semiautomático, risco médio é automático e alto pede aprovação', () => {
    expect(decideApproval('MEDIA_GENERATE', 'SEMI_AUTOMATIC').requiresApproval).toBe(
      false,
    );
    expect(decideApproval('COMMENT_REPLY', 'SEMI_AUTOMATIC').requiresApproval).toBe(
      false,
    );
    expect(decideApproval('CONTENT_PUBLISH', 'SEMI_AUTOMATIC').requiresApproval).toBe(
      true,
    );
    expect(decideApproval('DM_SEND', 'SEMI_AUTOMATIC').requiresApproval).toBe(true);
  });

  it('no modo autônomo, nenhuma ação pede aprovação', () => {
    for (const action of ALL_ACTIONS) {
      expect(decideApproval(action, 'AUTONOMOUS').requiresApproval).toBe(false);
    }
  });

  it('publicar e enviar mensagem são sempre de risco alto', () => {
    // Regra de produto: são as ações irreversíveis e públicas do sistema.
    expect(ACTION_RISK['CONTENT_PUBLISH']).toBe('HIGH');
    expect(ACTION_RISK['DM_SEND']).toBe('HIGH');
    expect(ACTION_RISK['FOLLOW_UP_SEND']).toBe('HIGH');
    expect(ACTION_RISK['CHECKOUT_LINK_SEND']).toBe('HIGH');
  });

  it('transferir para humano nunca depende de aprovação', () => {
    const modes: ApprovalMode[] = ['MANUAL', 'SEMI_AUTOMATIC', 'AUTONOMOUS'];

    for (const mode of modes) {
      expect(decideApproval('HUMAN_HANDOFF', mode).requiresApproval).toBe(false);
    }
  });

  it('sobrescrita por ação vence o modo, nos dois sentidos', () => {
    expect(
      decideApproval('DM_SEND', 'AUTONOMOUS', { DM_SEND: 'ALWAYS_ASK' })
        .requiresApproval,
    ).toBe(true);

    expect(
      decideApproval('CONTENT_PUBLISH', 'MANUAL', {
        CONTENT_PUBLISH: 'ALWAYS_AUTO',
      }).requiresApproval,
    ).toBe(false);
  });

  it('explica a decisão em português, para aparecer no painel', () => {
    const decision = decideApproval('CONTENT_PUBLISH', 'MANUAL');

    expect(decision.reason).toContain('HIGH');
    expect(decision.reason).toContain('manual');
  });
});
