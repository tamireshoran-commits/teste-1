import { describe, expect, it } from 'vitest';
import { computePricingMetrics } from '@/server/core/analysis/pricing/metrics';
import { CSVPriceLabsProvider } from '@/server/core/providers/pricing/CSVPriceLabsProvider';
import type { PricingDataset } from '@/server/core/types';

const provider = new CSVPriceLabsProvider();

const parse = (csv: string): PricingDataset => provider.parse(csv);

describe('computePricingMetrics — métricas centrais', () => {
  it('calcula ocupação a partir do status de reserva', () => {
    const csv = [
      'Date,Price,Booked',
      '2026-01-01,100,true',
      '2026-01-02,100,true',
      '2026-01-03,100,false',
      '2026-01-04,100,false',
    ].join('\n');

    const metrics = computePricingMetrics(parse(csv));

    expect(metrics.occupancy.available).toBe(true);
    expect(metrics.occupancy.value).toBeCloseTo(0.5);
  });

  it('calcula ADR apenas sobre as noites reservadas', () => {
    const csv = [
      'Date,Price,Booked',
      '2026-01-01,200,true',
      '2026-01-02,400,true',
      '2026-01-03,1000,false',
    ].join('\n');

    const metrics = computePricingMetrics(parse(csv));

    // Média de 200 e 400; a noite de 1000 não foi vendida.
    expect(metrics.adr.value).toBeCloseTo(300);
    expect(metrics.revenue.value).toBeCloseTo(600);
    // RevPAR = receita / total de noites disponíveis.
    expect(metrics.revpar.value).toBeCloseTo(200);
  });

  it('prefere ADR informado no CSV quando existe', () => {
    const csv = 'Date,Price,Booked,ADR\n2026-01-01,200,true,555';
    const metrics = computePricingMetrics(parse(csv));

    expect(metrics.adr.value).toBe(555);
    expect(metrics.adr.note).toContain('CSV');
  });

  it('marca métricas como indisponíveis em vez de inventar zero', () => {
    const metrics = computePricingMetrics(parse('Date,Price\n2026-01-01,100'));

    expect(metrics.adr.available).toBe(false);
    expect(metrics.adr.value).toBeNull();
    expect(metrics.revenue.available).toBe(false);
    expect(metrics.priceVsRecommendedPct.available).toBe(false);
    // A métrica que dá para calcular continua disponível.
    expect(metrics.averagePrice.value).toBe(100);
  });
});

describe('computePricingMetrics — preço vs. recomendado', () => {
  it('calcula o desvio médio e conta os dias de cada lado', () => {
    const csv = [
      'Date,Price,Recommended Price',
      '2026-01-01,90,100', // -10%
      '2026-01-02,80,100', // -20%
      '2026-01-03,110,100', // +10%
    ].join('\n');

    const metrics = computePricingMetrics(parse(csv));

    expect(metrics.priceVsRecommendedPct.value).toBeCloseTo(-6.67, 1);
    expect(metrics.daysBelowRecommended.value).toBe(2);
    expect(metrics.daysAboveRecommended.value).toBe(1);
  });

  it('ignora linhas em que o recomendado é zero, evitando divisão por zero', () => {
    const csv = [
      'Date,Price,Recommended Price',
      '2026-01-01,90,0',
      '2026-01-02,90,100',
    ].join('\n');

    const metrics = computePricingMetrics(parse(csv));

    expect(metrics.priceVsRecommendedPct.sampleSize).toBe(1);
    expect(metrics.priceVsRecommendedPct.value).toBeCloseTo(-10);
  });
});

describe('computePricingMetrics — fim de semana', () => {
  it('calcula o prêmio de sexta e sábado sobre os demais dias', () => {
    // 2026-01-01 quinta, 02 sexta, 03 sábado, 04 domingo.
    const csv = [
      'Date,Price',
      '2026-01-01,100',
      '2026-01-02,150',
      '2026-01-03,150',
      '2026-01-04,100',
    ].join('\n');

    const metrics = computePricingMetrics(parse(csv));

    // Fim de semana 150, dias úteis 100 => +50%.
    expect(metrics.weekendPremiumPct.value).toBeCloseTo(50);
  });

  it('fica indisponível quando só há dias de um tipo', () => {
    const csv = 'Date,Price\n2026-01-02,150\n2026-01-03,150';
    const metrics = computePricingMetrics(parse(csv));

    expect(metrics.weekendPremiumPct.available).toBe(false);
  });
});

describe('computePricingMetrics — gaps órfãos', () => {
  it('identifica um buraco menor que a estadia mínima entre reservas', () => {
    const csv = [
      'Date,Price,Booked,Min Stay',
      '2026-01-01,100,true,3',
      '2026-01-02,100,false,3',
      '2026-01-03,100,false,3',
      '2026-01-04,100,true,3',
    ].join('\n');

    const metrics = computePricingMetrics(parse(csv));

    expect(metrics.gaps).toHaveLength(1);
    expect(metrics.gaps[0]).toMatchObject({
      startDate: '2026-01-02',
      endDate: '2026-01-03',
      nights: 2,
      minStayRequired: 3,
      isOrphan: true,
    });
    expect(metrics.orphanGaps).toHaveLength(1);
  });

  it('não marca como órfão um buraco que comporta a estadia mínima', () => {
    const csv = [
      'Date,Price,Booked,Min Stay',
      '2026-01-01,100,true,2',
      '2026-01-02,100,false,2',
      '2026-01-03,100,false,2',
      '2026-01-04,100,true,2',
    ].join('\n');

    const metrics = computePricingMetrics(parse(csv));

    expect(metrics.gaps).toHaveLength(1);
    expect(metrics.orphanGaps).toHaveLength(0);
  });

  it('não considera gap o calendário aberto no início ou no fim', () => {
    const csv = [
      'Date,Price,Booked,Min Stay',
      '2026-01-01,100,false,3',
      '2026-01-02,100,true,3',
      '2026-01-03,100,false,3',
    ].join('\n');

    const metrics = computePricingMetrics(parse(csv));

    // Vazios nas bordas são disponibilidade normal, não buraco entre reservas.
    expect(metrics.gaps).toHaveLength(0);
  });

  it('não calcula gaps sem status de reserva', () => {
    const metrics = computePricingMetrics(parse('Date,Price\n2026-01-01,100'));
    expect(metrics.gaps).toHaveLength(0);
  });
});

describe('computePricingMetrics — eventos e sazonalidade', () => {
  it('compara o preço do dia de evento com a mediana do mês', () => {
    const csv = [
      'Date,Price,Events',
      '2026-01-01,100,',
      '2026-01-02,100,',
      '2026-01-03,100,',
      '2026-01-04,200,Réveillon',
    ].join('\n');

    const metrics = computePricingMetrics(parse(csv));

    expect(metrics.events).toHaveLength(1);
    expect(metrics.events[0]!.events).toEqual(['Réveillon']);
    // 200 contra a mediana 100 dos dias sem evento => +100%.
    expect(metrics.events[0]!.premiumVsBaselinePct).toBeCloseTo(100);
  });

  it('agrupa métricas por mês', () => {
    const csv = [
      'Date,Price',
      '2026-01-01,100',
      '2026-01-02,200',
      '2026-02-01,300',
    ].join('\n');

    const metrics = computePricingMetrics(parse(csv));

    expect(metrics.monthly).toHaveLength(2);
    expect(metrics.monthly[0]).toMatchObject({ month: '2026-01', days: 2 });
    expect(metrics.monthly[0]!.averagePrice).toBeCloseTo(150);
    expect(metrics.monthly[1]).toMatchObject({ month: '2026-02', days: 1 });
  });
});

describe('computePricingMetrics — cobertura', () => {
  it('conta quantos dias trazem cada dimensão', () => {
    const csv = [
      'Date,Price,Recommended Price,Booked',
      '2026-01-01,100,120,true',
      '2026-01-02,,,',
    ].join('\n');

    const metrics = computePricingMetrics(parse(csv));

    expect(metrics.coverage.totalDays).toBe(2);
    expect(metrics.coverage.withPrice).toBe(1);
    expect(metrics.coverage.withRecommendedPrice).toBe(1);
    expect(metrics.coverage.withBookingStatus).toBe(1);
    expect(metrics.coverage.withMinMax).toBe(0);
  });
});
