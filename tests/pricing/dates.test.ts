import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  detectDateOrder,
  isWeekendDay,
  monthOf,
  parseDate,
  weekdayOf,
} from '@/server/core/providers/pricing/csv/dates';

describe('detectDateOrder', () => {
  it('detecta ISO', () => {
    expect(detectDateOrder(['2026-01-15', '2026-01-16'])).toBe('ISO');
  });

  it('detecta DMY quando o primeiro campo passa de 12', () => {
    expect(detectDateOrder(['01/03/2026', '15/03/2026'])).toBe('DMY');
  });

  it('detecta MDY quando o segundo campo passa de 12', () => {
    expect(detectDateOrder(['03/15/2026', '03/16/2026'])).toBe('MDY');
  });

  it('assume DMY quando não há evidência decisiva', () => {
    // 03/04 é ambíguo; o padrão do público-alvo é DMY.
    expect(detectDateOrder(['03/04/2026'])).toBe('DMY');
  });

  it('ignora valores vazios ao decidir', () => {
    expect(detectDateOrder(['', '-', '25/12/2026'])).toBe('DMY');
  });
});

describe('parseDate', () => {
  it('interpreta ISO independentemente da ordem detectada', () => {
    expect(parseDate('2026-03-15', 'DMY')).toBe('2026-03-15');
    expect(parseDate('2026-3-5', 'MDY')).toBe('2026-03-05');
  });

  it('respeita a ordem DMY', () => {
    expect(parseDate('15/03/2026', 'DMY')).toBe('2026-03-15');
    expect(parseDate('05/04/2026', 'DMY')).toBe('2026-04-05');
  });

  it('respeita a ordem MDY', () => {
    expect(parseDate('03/15/2026', 'MDY')).toBe('2026-03-15');
    expect(parseDate('04/05/2026', 'MDY')).toBe('2026-04-05');
  });

  it('aceita separadores ponto e hífen', () => {
    expect(parseDate('15.03.2026', 'DMY')).toBe('2026-03-15');
    expect(parseDate('15-03-2026', 'DMY')).toBe('2026-03-15');
  });

  it('interpreta ano de dois dígitos', () => {
    expect(parseDate('15/03/26', 'DMY')).toBe('2026-03-15');
    expect(parseDate('15/03/99', 'DMY')).toBe('1999-03-15');
  });

  it('rejeita datas inválidas em vez de normalizá-las', () => {
    // 31 de fevereiro não vira 3 de março.
    expect(parseDate('31/02/2026', 'DMY')).toBeNull();
    expect(parseDate('32/01/2026', 'DMY')).toBeNull();
    expect(parseDate('15/13/2026', 'DMY')).toBeNull();
    expect(parseDate('2026-02-30', 'ISO')).toBeNull();
  });

  it('aceita 29 de fevereiro em ano bissexto', () => {
    expect(parseDate('29/02/2028', 'DMY')).toBe('2028-02-29');
    expect(parseDate('29/02/2027', 'DMY')).toBeNull();
  });

  it('devolve null para lixo', () => {
    expect(parseDate('', 'DMY')).toBeNull();
    expect(parseDate('N/A', 'DMY')).toBeNull();
    expect(parseDate('amanhã', 'DMY')).toBeNull();
  });
});

describe('weekdayOf e isWeekendDay', () => {
  it('calcula o dia da semana em UTC', () => {
    // 2026-01-01 é uma quinta-feira.
    expect(weekdayOf('2026-01-01')).toBe(4);
    // 2026-01-03 é sábado.
    expect(weekdayOf('2026-01-03')).toBe(6);
  });

  it('considera sexta e sábado como fim de semana', () => {
    expect(isWeekendDay(5)).toBe(true);
    expect(isWeekendDay(6)).toBe(true);
    expect(isWeekendDay(0)).toBe(false);
    expect(isWeekendDay(4)).toBe(false);
  });
});

describe('daysBetween, addDays e monthOf', () => {
  it('calcula a diferença em dias', () => {
    expect(daysBetween('2026-01-01', '2026-01-10')).toBe(9);
    expect(daysBetween('2026-01-10', '2026-01-01')).toBe(-9);
  });

  it('atravessa fronteira de mês e ano', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('extrai o mês', () => {
    expect(monthOf('2026-03-15')).toBe('2026-03');
  });
});
