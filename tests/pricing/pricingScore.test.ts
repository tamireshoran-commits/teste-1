import { describe, expect, it } from 'vitest';
import { computePricingMetrics } from '@/server/core/analysis/pricing/metrics';
import { computePricingScore } from '@/server/core/analysis/pricing/pricingScore';
import { PricingAnalysisService } from '@/server/core/analysis/pricing/PricingAnalysisService';
import { DEFAULT_SCORING_CONFIG } from '@/server/core/analysis/scoring/config';
import { CSVPriceLabsProvider } from '@/server/core/providers/pricing/CSVPriceLabsProvider';

const provider = new CSVPriceLabsProvider();
const scoreOf = (csv: string) =>
  computePricingScore(computePricingMetrics(provider.parse(csv)));

/** Gera um calendário sintético com controle fino sobre cada dia. */
function buildCsv(
  days: number,
  fn: (index: number, date: string) => Record<string, string | number>,
): string {
  const rows: string[] = [];
  let headers: string[] = [];

  for (let i = 0; i < days; i++) {
    const date = new Date(Date.UTC(2026, 0, 1 + i));
    const iso = date.toISOString().slice(0, 10);
    const record: Record<string, string | number> = { Date: iso, ...fn(i, iso) };

    if (i === 0) headers = Object.keys(record);
    rows.push(headers.map((h) => String(record[h] ?? '')).join(','));
  }

  return [headers.join(','), ...rows].join('\n');
}

describe('computePricingScore — faixa e forma', () => {
  it('devolve um score inteiro entre 0 e 100', () => {
    const score = scoreOf('Date,Price\n2026-01-01,100');

    expect(Number.isInteger(score.score)).toBe(true);
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(100);
  });

  it('expõe a versão da configuração usada', () => {
    expect(scoreOf('Date,Price\n2026-01-01,100').configVersion).toBe(
      DEFAULT_SCORING_CONFIG.version,
    );
  });

  it('dá uma razão em texto para cada componente', () => {
    const score = scoreOf('Date,Price\n2026-01-01,100');

    for (const component of score.components) {
      expect(component.reason.length).toBeGreaterThan(10);
    }
  });
});

describe('computePricingScore — dados ausentes', () => {
  it('marca componentes sem dado como indisponíveis, não como zero', () => {
    const score = scoreOf('Date,Price\n2026-01-01,100');

    const alignment = score.components.find(
      (c) => c.key === 'recommendationAlignment',
    )!;

    expect(alignment.available).toBe(false);
    expect(alignment.score).toBeNull();
    expect(alignment.effectiveWeight).toBe(0);
  });

  it('redistribui o peso dos componentes indisponíveis', () => {
    const score = scoreOf('Date,Price\n2026-01-01,100');

    const totalEffective = score.components.reduce(
      (acc, c) => acc + c.effectiveWeight,
      0,
    );

    expect(totalEffective).toBeCloseTo(100);
  });

  it('reporta a cobertura dos pesos avaliados', () => {
    const poor = scoreOf('Date,Price\n2026-01-01,100');
    const rich = scoreOf(
      buildCsv(30, (i) => ({
        Price: 200,
        'Recommended Price': 200,
        'Min Price': 100,
        'Max Price': 400,
        Booked: i % 3 === 0 ? 'false' : 'true',
        'Min Stay': 2,
        Discount: 5,
      })),
    );

    expect(rich.coverage).toBeGreaterThan(poor.coverage);
    expect(rich.coverage).toBeLessThanOrEqual(1);
  });

  it('não pune o usuário por um CSV incompleto', () => {
    // Um arquivo mínimo, mas sem nada de errado, não deve zerar o score.
    const score = scoreOf('Date,Price\n2026-01-01,100');
    expect(score.score).toBeGreaterThan(0);
  });
});

describe('computePricingScore — sensibilidade das regras', () => {
  it('pontua melhor quem está alinhado ao preço recomendado', () => {
    const aligned = scoreOf(
      buildCsv(14, () => ({ Price: 200, 'Recommended Price': 200 })),
    );
    const misaligned = scoreOf(
      buildCsv(14, () => ({ Price: 120, 'Recommended Price': 200 })),
    );

    expect(aligned.score).toBeGreaterThan(misaligned.score);
  });

  it('pontua melhor quem diferencia fim de semana', () => {
    // 2026-01-01 é quinta; 02 sexta, 03 sábado.
    const differentiated = scoreOf(
      buildCsv(28, (_i, iso) => {
        const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
        return { Price: day === 5 || day === 6 ? 250 : 200 };
      }),
    );
    const flat = scoreOf(buildCsv(28, () => ({ Price: 200 })));

    expect(differentiated.score).toBeGreaterThan(flat.score);
  });

  it('penaliza desconto agressivo', () => {
    const modest = scoreOf(buildCsv(14, () => ({ Price: 200, Discount: 5 })));
    const aggressive = scoreOf(buildCsv(14, () => ({ Price: 200, Discount: 60 })));

    expect(modest.score).toBeGreaterThan(aggressive.score);
  });

  it('penaliza ocupação muito baixa e muito alta em relação à faixa saudável', () => {
    const healthy = scoreOf(
      buildCsv(20, (i) => ({ Price: 200, Booked: i % 10 < 7 ? 'true' : 'false' })),
    );
    const tooLow = scoreOf(
      buildCsv(20, (i) => ({ Price: 200, Booked: i % 10 < 1 ? 'true' : 'false' })),
    );
    const tooHigh = scoreOf(buildCsv(20, () => ({ Price: 200, Booked: 'true' })));

    const occupancyOf = (s: ReturnType<typeof scoreOf>) =>
      s.components.find((c) => c.key === 'occupancyHealth')!.score!;

    expect(occupancyOf(healthy)).toBeGreaterThan(occupancyOf(tooLow));
    expect(occupancyOf(healthy)).toBeGreaterThan(occupancyOf(tooHigh));
  });
});

describe('PricingAnalysisService', () => {
  const service = new PricingAnalysisService(provider);

  it('produz score, problemas, oportunidades e resumo', async () => {
    const csv = buildCsv(30, (i) => ({
      Price: 120,
      'Recommended Price': 200,
      Booked: i % 10 < 8 ? 'true' : 'false',
    }));

    const { dataset, analysis } = await service.analyzeFromCsv(csv, 'teste.csv');

    expect(dataset.rowCount).toBe(30);
    expect(analysis.score.score).toBeGreaterThanOrEqual(0);
    expect(analysis.summary).toContain('Pricing Score');

    // Preço 40% abaixo do recomendado tem de aparecer como problema.
    expect(analysis.problems.some((p) => p.code === 'BELOW_RECOMMENDED')).toBe(true);
  });

  it('gera oportunidade de alta quando há preço baixo e demanda alta', async () => {
    const csv = buildCsv(30, (i) => ({
      Price: 120,
      'Recommended Price': 200,
      Booked: i % 10 < 8 ? 'true' : 'false',
    }));

    const { analysis } = await service.analyzeFromCsv(csv);
    const opportunity = analysis.opportunities.find(
      (o) => o.code === 'RAISE_PRICE_HIGH_DEMAND',
    );

    expect(opportunity).toBeDefined();
    expect(opportunity!.evidence).toBeDefined();
  });

  it('nunca promete resultado financeiro nas oportunidades', async () => {
    const csv = buildCsv(30, (i) => ({
      Price: 120,
      'Recommended Price': 200,
      Booked: i % 10 < 8 ? 'true' : 'false',
      Discount: 40,
    }));

    const { analysis } = await service.analyzeFromCsv(csv);

    expect(analysis.opportunities.length).toBeGreaterThan(0);

    const permitido = [
      'oportunidade potencial',
      'recomendação',
      'estimativa',
      'hipótese',
    ];

    for (const opportunity of analysis.opportunities) {
      expect(permitido).toContain(opportunity.framing);

      const texto = `${opportunity.title} ${opportunity.detail}`.toLowerCase();
      // Linguagem de garantia é proibida por decisão de produto.
      expect(texto).not.toMatch(/garant|com certeza|vai aumentar sua receita/);
    }
  });

  it('toda oportunidade carrega evidência', async () => {
    const csv = buildCsv(30, (i) => ({
      Price: 120,
      'Recommended Price': 200,
      Booked: i % 10 < 8 ? 'true' : 'false',
    }));

    const { analysis } = await service.analyzeFromCsv(csv);

    for (const opportunity of analysis.opportunities) {
      expect(opportunity.evidence).toBeDefined();
      expect(Object.keys(opportunity.evidence!).length).toBeGreaterThan(0);
    }
  });
});
