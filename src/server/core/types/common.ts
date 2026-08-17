/**
 * Tipos base do domínio.
 *
 * Deliberadamente independentes do Prisma: o domínio não importa nada da
 * camada de persistência, o que permite testar as regras sem banco e trocar o
 * ORM sem tocar em regra de negócio.
 */

export type Platform = 'AIRBNB' | 'BOOKING';

export type ListingSource = 'MANUAL' | 'MOCK' | 'API';

export type PricingSourceName = 'CSV_PRICELABS' | 'PRICELABS_API';

export type ImpactLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

export type StepType =
  | 'AIRBNB'
  | 'BOOKING'
  | 'PHOTOS'
  | 'PRICING'
  | 'RECOMMENDATIONS'
  | 'REPORT';

/**
 * Um componente de um score.
 *
 * `available: false` significa "não havia dado para avaliar isto" — nesse caso
 * o peso é redistribuído entre os componentes disponíveis em vez de o
 * componente entrar como zero e punir o usuário por um dado que ele não tem.
 */
export interface ScoreComponent {
  key: string;
  label: string;
  /** 0..100. Null quando `available` é false. */
  score: number | null;
  /** Peso relativo declarado na configuração. */
  weight: number;
  /** Peso efetivamente aplicado após redistribuição. */
  effectiveWeight: number;
  available: boolean;
  /** Explicação em linguagem natural do porquê deste valor. */
  reason: string;
}

export interface ScoreResult {
  /** 0..100. */
  score: number;
  components: ScoreComponent[];
  /** Fração dos pesos que pôde ser avaliada (0..1). */
  coverage: number;
  /** Versão da configuração de pesos usada. */
  configVersion: string;
}

/** Problema detectado por uma análise. */
export interface Finding {
  code: string;
  title: string;
  detail: string;
  severity: ImpactLevel;
  /** Dados concretos que sustentam o achado — nunca texto solto. */
  evidence?: Record<string, unknown>;
}

/**
 * Oportunidade identificada.
 *
 * Por decisão de produto, oportunidades NUNCA são apresentadas como garantia
 * de resultado: o campo `framing` obriga a linguagem de hipótese.
 */
export interface Opportunity {
  code: string;
  title: string;
  detail: string;
  impact: ImpactLevel;
  framing: 'oportunidade potencial' | 'recomendação' | 'estimativa' | 'hipótese';
  evidence?: Record<string, unknown>;
}

/** Aviso não bloqueante gerado durante parsing/validação. */
export interface Warning {
  code: string;
  message: string;
  context?: Record<string, unknown>;
}
