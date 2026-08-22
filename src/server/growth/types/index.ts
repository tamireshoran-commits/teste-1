/**
 * DTOs do Growth Engine.
 *
 * Espelham os enums do Prisma como uniões de string para que o núcleo (agentes,
 * políticas, scoring) continue compilando sem importar o client gerado — a
 * mesma separação que o módulo de análise já usa. Os valores são idênticos aos
 * do schema, então a conversão entre camadas é atribuição direta.
 */

export type ApprovalMode = 'MANUAL' | 'SEMI_AUTOMATIC' | 'AUTONOMOUS';

export type SocialPlatform = 'INSTAGRAM' | 'FACEBOOK';

export type ConversationChannel =
  | 'IG_DM'
  | 'IG_COMMENT'
  | 'FB_MESSENGER'
  | 'FB_COMMENT';

export type ContentObjective = 'REACH' | 'ENGAGEMENT' | 'LEADS' | 'SALES';

export type ContentFormat = 'REEL' | 'CAROUSEL' | 'IMAGE' | 'STORY' | 'TEXT';

export type FunnelStage =
  | 'AWARENESS'
  | 'INTEREST'
  | 'CONSIDERATION'
  | 'DECISION'
  | 'RETENTION';

export type MediaKind = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'THUMBNAIL' | 'CAPTIONS';

export type LeadTemperature = 'COLD' | 'WARM' | 'HOT' | 'READY';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type AgentKind =
  | 'MARKET_STRATEGIST'
  | 'CONTENT_STRATEGIST'
  | 'VIDEO_CREATOR'
  | 'SOCIAL_MANAGER'
  | 'LEAD_QUALIFIER'
  | 'SALES_REP'
  | 'LEARNING_ANALYST';

/** Ações com efeito externo. Toda uma passa pela `ApprovalPolicy`. */
export type GrowthAction =
  | 'STRATEGY_GENERATE'
  | 'CONTENT_GENERATE'
  | 'MEDIA_GENERATE'
  | 'CONTENT_PUBLISH'
  | 'COMMENT_REPLY'
  | 'DM_SEND'
  | 'FOLLOW_UP_SEND'
  | 'CHECKOUT_LINK_SEND'
  | 'HUMAN_HANDOFF';

/** Configuração de guardrails do workspace, lida do banco. */
export interface WorkspaceSettings {
  id: string;
  mode: ApprovalMode;
  timezone: string;
  quietHoursStart: number;
  quietHoursEnd: number;
  maxDailyCostUsd: number;
  maxMessagesPerContactPerDay: number;
  maxPublicationsPerDay: number;
}

/** Produto que o agente de vendas pode citar. Nada fora desta lista. */
export interface ProductSummary {
  id: string;
  name: string;
  description: string;
  priceCents: number | null;
  currency: string;
  checkoutUrl: string | null;
  schedulingUrl: string | null;
  benefits: string[];
}

/** Contexto de marca injetado nos prompts que produzem texto público. */
export interface BrandContext {
  name: string;
  description: string | null;
  toneOfVoice: string;
  valueProposition: string | null;
  doNotSay: string[];
  guardrails: string[];
  defaultCta: string | null;
  language: string;
}

export interface ConversationTurn {
  direction: 'INBOUND' | 'OUTBOUND';
  text: string;
  at: Date;
}
