import { describe, expect, it } from 'vitest';
import { CSVPriceLabsProvider } from '@/server/core/providers/pricing/CSVPriceLabsProvider';
import { ValidationError } from '@/server/core/shared/errors';

const provider = new CSVPriceLabsProvider();

const CSV_EN = `Date,Price,Recommended Price,Min Price,Max Price,Occupancy,Booked,Min Stay
2026-01-01,250,280,150,600,0.75,true,2
2026-01-02,250,290,150,600,0.80,true,2
2026-01-03,300,340,150,600,0.90,false,2
`;

describe('CSVPriceLabsProvider — casos válidos', () => {
  it('interpreta um CSV padrão em inglês', () => {
    const dataset = provider.parse(CSV_EN, 'export.csv');

    expect(dataset.source).toBe('CSV_PRICELABS');
    expect(dataset.fileName).toBe('export.csv');
    expect(dataset.rowCount).toBe(3);
    expect(dataset.skippedCount).toBe(0);
    expect(dataset.dateFrom).toBe('2026-01-01');
    expect(dataset.dateTo).toBe('2026-01-03');

    const first = dataset.rows[0]!;
    expect(first.price).toBe(250);
    expect(first.recommendedPrice).toBe(280);
    expect(first.minPrice).toBe(150);
    expect(first.maxPrice).toBe(600);
    expect(first.occupancy).toBeCloseTo(0.75);
    expect(first.booked).toBe(true);
    expect(first.minStay).toBe(2);
  });

  it('interpreta um CSV brasileiro com ; e vírgula decimal', () => {
    const csv = [
      'Data;Preço;Preço Recomendado;Ocupação;Reservado',
      '15/03/2026;R$ 1.250,50;R$ 1.400,00;85%;sim',
      '16/03/2026;R$ 1.250,50;R$ 1.300,00;90%;não',
    ].join('\n');

    const dataset = provider.parse(csv);

    expect(dataset.rowCount).toBe(2);
    expect(dataset.currency).toBe('BRL');

    const first = dataset.rows[0]!;
    expect(first.date).toBe('2026-03-15');
    expect(first.price).toBe(1250.5);
    expect(first.recommendedPrice).toBe(1400);
    expect(first.occupancy).toBeCloseTo(0.85);
    expect(first.booked).toBe(true);
    expect(dataset.rows[1]!.booked).toBe(false);
  });

  it('deriva dia da semana e fim de semana', () => {
    // 2026-01-02 é sexta, 2026-01-03 é sábado.
    const dataset = provider.parse(CSV_EN);

    expect(dataset.rows[0]!.isWeekend).toBe(false); // quinta
    expect(dataset.rows[1]!.isWeekend).toBe(true); // sexta
    expect(dataset.rows[2]!.isWeekend).toBe(true); // sábado
  });

  it('ordena as linhas por data mesmo se o arquivo vier fora de ordem', () => {
    const csv = 'Date,Price\n2026-01-05,300\n2026-01-01,100\n2026-01-03,200';
    const dataset = provider.parse(csv);

    expect(dataset.rows.map((r) => r.date)).toEqual([
      '2026-01-01',
      '2026-01-03',
      '2026-01-05',
    ]);
  });

  it('guarda a linha original para auditoria', () => {
    const dataset = provider.parse('Date,Price,Nota\n2026-01-01,100,teste');

    expect(dataset.rows[0]!.raw).toMatchObject({
      Date: '2026-01-01',
      Price: '100',
      Nota: 'teste',
    });
  });

  it('registra o mapeamento de colunas', () => {
    const dataset = provider.parse(CSV_EN);

    expect(dataset.columnMapping['Date']).toBe('date');
    expect(dataset.columnMapping['Recommended Price']).toBe('recommendedPrice');
  });
});

describe('CSVPriceLabsProvider — robustez', () => {
  it('descarta linhas com data inválida e avisa, sem derrubar o import', () => {
    const csv = [
      'Date,Price',
      '2026-01-01,100',
      'invalido,200',
      ',300',
      '2026-01-02,400',
    ].join('\n');

    const dataset = provider.parse(csv);

    expect(dataset.rowCount).toBe(2);
    expect(dataset.skippedCount).toBe(2);
    expect(dataset.warnings.some((w) => w.code === 'INVALID_DATE_ROWS')).toBe(true);
  });

  it('mantém a última ocorrência de datas duplicadas e avisa', () => {
    const csv = 'Date,Price\n2026-01-01,100\n2026-01-01,999';
    const dataset = provider.parse(csv);

    expect(dataset.rowCount).toBe(1);
    expect(dataset.rows[0]!.price).toBe(999);
    expect(dataset.warnings.some((w) => w.code === 'DUPLICATE_DATES')).toBe(true);
  });

  it('descarta preço negativo e avisa', () => {
    const dataset = provider.parse('Date,Price\n2026-01-01,-50');

    expect(dataset.rows[0]!.price).toBeNull();
    expect(dataset.warnings.some((w) => w.code === 'NEGATIVE_PRICE')).toBe(true);
  });

  it('descarta piso maior que teto e avisa', () => {
    const csv = 'Date,Min Price,Max Price\n2026-01-01,900,100';
    const dataset = provider.parse(csv);

    expect(dataset.rows[0]!.minPrice).toBeNull();
    expect(dataset.rows[0]!.maxPrice).toBeNull();
    expect(dataset.warnings.some((w) => w.code === 'MIN_ABOVE_MAX')).toBe(true);
  });

  it('descarta ocupação fora da faixa e avisa', () => {
    const dataset = provider.parse('Date,Occupancy\n2026-01-01,350%');

    expect(dataset.rows[0]!.occupancy).toBeNull();
    expect(
      dataset.warnings.some((w) => w.code === 'OCCUPANCY_OUT_OF_RANGE'),
    ).toBe(true);
  });

  it('avisa sobre dias faltando no calendário', () => {
    const csv = 'Date,Price\n2026-01-01,100\n2026-01-10,200';
    const dataset = provider.parse(csv);

    const warning = dataset.warnings.find(
      (w) => w.code === 'MISSING_CALENDAR_DAYS',
    );

    expect(warning).toBeDefined();
    expect(warning!.context).toMatchObject({ expectedDays: 10, presentDays: 2 });
  });

  it('avisa sobre colunas úteis ausentes', () => {
    const dataset = provider.parse('Date,Price\n2026-01-01,100');

    const warning = dataset.warnings.find(
      (w) => w.code === 'MISSING_USEFUL_COLUMNS',
    );

    expect(warning).toBeDefined();
    expect(warning!.message).toContain('preço recomendado');
  });

  it('avisa sobre colunas não reconhecidas', () => {
    const dataset = provider.parse('Date,Price,XPTO\n2026-01-01,100,foo');

    expect(dataset.warnings.some((w) => w.code === 'UNMAPPED_COLUMNS')).toBe(true);
  });
});

describe('CSVPriceLabsProvider — erros', () => {
  it('rejeita arquivo vazio', () => {
    expect(() => provider.parse('')).toThrow(ValidationError);
    expect(() => provider.parse('   \n  ')).toThrow(ValidationError);
  });

  it('rejeita arquivo só com cabeçalho', () => {
    expect(() => provider.parse('Date,Price')).toThrow(ValidationError);
  });

  it('rejeita CSV sem coluna de data, explicando o que faltou', () => {
    expect(() => provider.parse('Preco,Ocupacao\n100,0.8')).toThrow(
      /coluna de data/i,
    );
  });

  it('rejeita quando nenhuma linha tem data válida', () => {
    expect(() => provider.parse('Date,Price\nfoo,100\nbar,200')).toThrow(
      /Nenhuma linha/i,
    );
  });

  it('rejeita entrada que não seja CSV pela interface do provider', async () => {
    await expect(
      provider.load({ kind: 'api', listingId: '123' }),
    ).rejects.toThrow(ValidationError);
  });
});
