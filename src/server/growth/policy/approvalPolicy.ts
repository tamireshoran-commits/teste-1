import type { ApprovalMode, GrowthAction, RiskLevel } from '../types';

/**
 * Quem decide o que pode ser executado sem humano.
 *
 * A regra não é um booleano "automático sim/não": é a combinação do **risco da
 * ação** com o **modo do workspace**. Risco aqui significa uma coisa só:
 * quanto custa desfazer. Gerar um rascunho é reversível (apagar); publicar um
 * Reels e enviar uma DM não são.
 */

export const ACTION_RISK: Record<GrowthAction, RiskLevel> = {
  STRATEGY_GENERATE: 'LOW',
  CONTENT_GENERATE: 'LOW',
  // Média porque gasta crédito de API de imagem/vídeo, que é o item mais caro
  // do sistema — mas nada sai para o público.
  MEDIA_GENERATE: 'MEDIUM',
  CONTENT_PUBLISH: 'HIGH',
  COMMENT_REPLY: 'MEDIUM',
  DM_SEND: 'HIGH',
  FOLLOW_UP_SEND: 'HIGH',
  CHECKOUT_LINK_SEND: 'HIGH',
  HUMAN_HANDOFF: 'LOW',
};

const AUTO_UP_TO: Record<ApprovalMode, RiskLevel> = {
  MANUAL: 'LOW',
  SEMI_AUTOMATIC: 'MEDIUM',
  AUTONOMOUS: 'HIGH',
};

const RISK_ORDER: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/** Sobrescrita por ação, definida no workspace. */
export type ActionOverride = 'ALWAYS_ASK' | 'ALWAYS_AUTO';

export interface ApprovalDecision {
  action: GrowthAction;
  risk: RiskLevel;
  mode: ApprovalMode;
  requiresApproval: boolean;
  reason: string;
}

/**
 * Decide se a ação executa direto ou vira pedido de aprovação.
 *
 * Note o que esta função **não** faz: ela nunca autoriza o envio em si. Mesmo
 * `requiresApproval: false` ainda passa pela `MessagingPolicy`, que é a camada
 * que conhece as regras da plataforma. Modo autônomo acelera o que é
 * permitido; não transforma proibido em permitido.
 */
export function decideApproval(
  action: GrowthAction,
  mode: ApprovalMode,
  overrides: Partial<Record<GrowthAction, ActionOverride>> = {},
): ApprovalDecision {
  const risk = ACTION_RISK[action];
  const override = overrides[action];

  if (override === 'ALWAYS_ASK') {
    return {
      action,
      risk,
      mode,
      requiresApproval: true,
      reason: 'Ação marcada como "sempre pedir aprovação" na configuração.',
    };
  }

  if (override === 'ALWAYS_AUTO') {
    return {
      action,
      risk,
      mode,
      requiresApproval: false,
      reason: 'Ação marcada como "sempre automática" na configuração.',
    };
  }

  const requiresApproval = RISK_ORDER[risk] > RISK_ORDER[AUTO_UP_TO[mode]];

  return {
    action,
    risk,
    mode,
    requiresApproval,
    reason: requiresApproval
      ? `Ação de risco ${risk} exige aprovação no modo ${MODE_LABEL[mode]}.`
      : `Ação de risco ${risk} é automática no modo ${MODE_LABEL[mode]}.`,
  };
}

export const MODE_LABEL: Record<ApprovalMode, string> = {
  MANUAL: 'manual',
  SEMI_AUTOMATIC: 'semiautomático',
  AUTONOMOUS: 'autônomo',
};

export const ACTION_LABEL: Record<GrowthAction, string> = {
  STRATEGY_GENERATE: 'Gerar estratégia de mercado',
  CONTENT_GENERATE: 'Gerar plano de conteúdo',
  MEDIA_GENERATE: 'Gerar mídia (imagem/vídeo)',
  CONTENT_PUBLISH: 'Publicar conteúdo',
  COMMENT_REPLY: 'Responder comentário',
  DM_SEND: 'Enviar mensagem direta',
  FOLLOW_UP_SEND: 'Enviar follow-up',
  CHECKOUT_LINK_SEND: 'Enviar link de compra',
  HUMAN_HANDOFF: 'Transferir para atendimento humano',
};
