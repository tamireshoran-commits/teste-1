import { describe, expect, it } from 'vitest';
import {
  aggregateByDimension,
  type PiecePerformance,
} from '@/server/growth/analytics/performance';

function piece(overrides: Partial<PiecePerformance> = {}): PiecePerformance {
  return {
    contentPieceId: 'p1',
    theme: 'preço',
    hook: 'você está pagando caro',
    cta: 'comente ORÇAMENTO',
    format: 'REEL',
    funnelStage: 'INTEREST',
    objective: 'LEADS',
    publishedAt: '2026-03-01T12:00:00Z',
    reach: 1000,
    impressions: 1400,
    engagement: 100,
    engagementRate: 0.1,
    comments: 20,
    conversations: 10,
    leads: 5,
    qualifiedLeads: 2,
    deals: 1,
    revenueCents: 49700,
    ...overrides,
  };
}

describe('agregação do módulo de aprendizado', () => {
  it('calcula leads por post e conversão por dimensão', () => {
    const aggregates = aggregateByDimension([
      piece({ contentPieceId: 'a', theme: 'preço', leads: 6, deals: 2 }),
      piece({ contentPieceId: 'b', theme: 'preço', leads: 4, deals: 0 }),
      piece({ contentPieceId: 'c', theme: 'bastidores', leads: 1, deals: 0 }),
    ]);

    const preco = aggregates.find(
      (a) => a.dimension === 'THEME' && a.subject === 'preço',
    );

    expect(preco?.sampleSize).toBe(2);
    expect(preco?.leadsPerPost).toBe(5);
    // 2 vendas em 10 leads.
    expect(preco?.conversionRate).toBe(0.2);

    const bastidores = aggregates.find(
      (a) => a.dimension === 'THEME' && a.subject === 'bastidores',
    );

    expect(bastidores?.leadsPerPost).toBe(1);
  });

  it('agrega a mesma peça em todas as dimensões', () => {
    const dimensions = new Set(
      aggregateByDimension([piece()]).map((a) => a.dimension),
    );

    expect(dimensions).toEqual(
      new Set(['THEME', 'HOOK', 'CTA', 'FORMAT', 'FUNNEL_STAGE']),
    );
  });

  it('ordena por leads por post, que é o que interessa ao estrategista', () => {
    const aggregates = aggregateByDimension([
      piece({ contentPieceId: 'a', theme: 'fraco', leads: 0 }),
      piece({ contentPieceId: 'b', theme: 'forte', leads: 9 }),
    ]);

    expect(aggregates[0]?.leadsPerPost).toBeGreaterThanOrEqual(
      aggregates[aggregates.length - 1]?.leadsPerPost ?? 0,
    );
  });

  it('não divide por zero quando não houve lead', () => {
    const aggregates = aggregateByDimension([piece({ leads: 0, deals: 0 })]);

    for (const aggregate of aggregates) {
      expect(Number.isFinite(aggregate.conversionRate)).toBe(true);
      expect(aggregate.conversionRate).toBe(0);
    }
  });

  it('ignora dimensão vazia em vez de criar um grupo sem nome', () => {
    const aggregates = aggregateByDimension([piece({ cta: '  ' })]);

    expect(aggregates.some((a) => a.dimension === 'CTA')).toBe(false);
  });
});
