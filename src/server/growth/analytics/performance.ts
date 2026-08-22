/**
 * Cálculo de desempenho de conteúdo.
 *
 * Módulo puro de propósito: não importa Prisma nem Next, então roda em teste
 * unitário sem banco. É aqui que moram as contas que o módulo de aprendizado
 * apresenta ao modelo — e conta errada aqui vira "insight" errado no
 * calendário seguinte.
 */

export interface PiecePerformance {
  contentPieceId: string;
  theme: string;
  hook: string;
  cta: string;
  format: string;
  funnelStage: string;
  objective: string;
  publishedAt: string | null;
  reach: number;
  impressions: number;
  engagement: number;
  engagementRate: number;
  comments: number;
  conversations: number;
  leads: number;
  qualifiedLeads: number;
  deals: number;
  revenueCents: number;
}

/**
 * Declarado como `type` e não `interface` de propósito: o Prisma exige tipo
 * com índice implícito para gravar em coluna Json, e interface não tem.
 */
export type DimensionAggregate = {
  dimension: 'THEME' | 'HOOK' | 'CTA' | 'FORMAT' | 'FUNNEL_STAGE';
  subject: string;
  sampleSize: number;
  avgReach: number;
  avgEngagementRate: number;
  leadsPerPost: number;
  conversionRate: number;
  revenueCents: number;
};

/**
 * Agrega por dimensão.
 *
 * Uma peça entra em todas as dimensões (tema, gancho, CTA, formato, etapa) —
 * é o que permite responder "qual gancho gera mais comentário" e "qual CTA
 * converte melhor" com os mesmos dados brutos.
 */
export function aggregateByDimension(
  performance: readonly PiecePerformance[],
): DimensionAggregate[] {
  const dimensions: Array<{
    dimension: DimensionAggregate['dimension'];
    key: (piece: PiecePerformance) => string;
  }> = [
    { dimension: 'THEME', key: (p) => p.theme },
    { dimension: 'HOOK', key: (p) => p.hook },
    { dimension: 'CTA', key: (p) => p.cta },
    { dimension: 'FORMAT', key: (p) => p.format },
    { dimension: 'FUNNEL_STAGE', key: (p) => p.funnelStage },
  ];

  const result: DimensionAggregate[] = [];

  for (const { dimension, key } of dimensions) {
    const groups = new Map<string, PiecePerformance[]>();

    for (const piece of performance) {
      const subject = key(piece).trim();
      if (subject === '') continue;

      const group = groups.get(subject) ?? [];
      group.push(piece);
      groups.set(subject, group);
    }

    for (const [subject, group] of groups) {
      const leads = sum(group.map((p) => p.leads));

      result.push({
        dimension,
        subject,
        sampleSize: group.length,
        avgReach: round(average(group.map((p) => p.reach)), 1),
        avgEngagementRate: round(average(group.map((p) => p.engagementRate)), 4),
        leadsPerPost: round(leads / group.length, 2),
        conversionRate:
          leads > 0 ? round(sum(group.map((p) => p.deals)) / leads, 4) : 0,
        revenueCents: sum(group.map((p) => p.revenueCents)),
      });
    }
  }

  return result.sort((a, b) => b.leadsPerPost - a.leadsPerPost);
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

