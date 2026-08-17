import { describe, expect, it } from 'vitest';
import {
  isEmptyValue,
  toBoolean,
  toInteger,
  toList,
  toNumber,
  toPercent,
  toRatio,
  toText,
} from '@/server/core/providers/pricing/csv/coerce';

describe('toNumber', () => {
  it('interpreta números simples', () => {
    expect(toNumber('150')).toBe(150);
    expect(toNumber('150.50')).toBe(150.5);
    expect(toNumber(' 42 ')).toBe(42);
  });

  it('interpreta o padrão brasileiro com vírgula decimal', () => {
    expect(toNumber('150,50')).toBe(150.5);
    expect(toNumber('1.234,56')).toBe(1234.56);
    expect(toNumber('1.234.567,89')).toBe(1234567.89);
  });

  it('interpreta o padrão americano com ponto decimal', () => {
    expect(toNumber('1,234.56')).toBe(1234.56);
    expect(toNumber('1,234,567.89')).toBe(1234567.89);
  });

  it('distingue separador de milhar de decimal quando há apenas um', () => {
    // 3 dígitos após o separador => milhar
    expect(toNumber('1.234')).toBe(1234);
    expect(toNumber('1,234')).toBe(1234);
    // Outro tamanho => decimal
    expect(toNumber('1.23')).toBe(1.23);
    expect(toNumber('1,5')).toBe(1.5);
  });

  it('remove símbolos de moeda e percentual', () => {
    expect(toNumber('R$ 250,00')).toBe(250);
    expect(toNumber('$199.99')).toBe(199.99);
    expect(toNumber('€ 1.500,75')).toBe(1500.75);
    expect(toNumber('15%')).toBe(15);
  });

  it('trata negativos, inclusive entre parênteses', () => {
    expect(toNumber('-50')).toBe(-50);
    expect(toNumber('(12,50)')).toBe(-12.5);
  });

  it('devolve null para valores vazios ou não numéricos', () => {
    expect(toNumber('')).toBeNull();
    expect(toNumber('-')).toBeNull();
    expect(toNumber('N/A')).toBeNull();
    expect(toNumber('n/a')).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber('abc')).toBeNull();
  });

  it('nunca devolve zero para dado ausente', () => {
    // Regressão: zero é um preço legítimo e não pode representar "sem dado".
    expect(toNumber('')).not.toBe(0);
    expect(toNumber('0')).toBe(0);
  });
});

describe('toRatio', () => {
  it('converte percentual para fração', () => {
    expect(toRatio('85%')).toBeCloseTo(0.85);
    expect(toRatio('85')).toBeCloseTo(0.85);
  });

  it('mantém frações já normalizadas', () => {
    expect(toRatio('0.85')).toBeCloseTo(0.85);
    expect(toRatio('0,85')).toBeCloseTo(0.85);
  });

  it('respeita o símbolo de percentual mesmo abaixo de 1', () => {
    expect(toRatio('0.5%')).toBeCloseTo(0.005);
  });

  it('devolve null para vazio', () => {
    expect(toRatio('')).toBeNull();
    expect(toRatio('N/A')).toBeNull();
  });
});

describe('toPercent', () => {
  it('mantém a escala percentual', () => {
    expect(toPercent('12,5%')).toBeCloseTo(12.5);
    expect(toPercent('12.5')).toBeCloseTo(12.5);
  });

  it('converte fração para percentual quando não há símbolo', () => {
    expect(toPercent('0.15')).toBeCloseTo(15);
  });

  it('preserva zero', () => {
    expect(toPercent('0')).toBe(0);
  });
});

describe('toBoolean', () => {
  it('reconhece valores verdadeiros em pt e en', () => {
    expect(toBoolean('true')).toBe(true);
    expect(toBoolean('Yes')).toBe(true);
    expect(toBoolean('sim')).toBe(true);
    expect(toBoolean('Booked')).toBe(true);
    expect(toBoolean('reservado')).toBe(true);
    expect(toBoolean('1')).toBe(true);
  });

  it('reconhece valores falsos em pt e en', () => {
    expect(toBoolean('false')).toBe(false);
    expect(toBoolean('no')).toBe(false);
    expect(toBoolean('disponível')).toBe(false);
    expect(toBoolean('available')).toBe(false);
    expect(toBoolean('0')).toBe(false);
  });

  it('devolve null para valores desconhecidos', () => {
    expect(toBoolean('talvez')).toBeNull();
    expect(toBoolean('')).toBeNull();
  });
});

describe('toInteger', () => {
  it('arredonda para inteiro', () => {
    expect(toInteger('3.6')).toBe(4);
    expect(toInteger('3,2')).toBe(3);
  });
});

describe('toList', () => {
  it('divide por ponto e vírgula, vírgula ou pipe', () => {
    expect(toList('Natal; Réveillon')).toEqual(['Natal', 'Réveillon']);
    expect(toList('a|b|c')).toEqual(['a', 'b', 'c']);
    expect(toList('Carnaval')).toEqual(['Carnaval']);
  });

  it('devolve lista vazia para valores ausentes', () => {
    expect(toList('')).toEqual([]);
    expect(toList('N/A')).toEqual([]);
    expect(toList(undefined)).toEqual([]);
  });
});

describe('toText e isEmptyValue', () => {
  it('reconhece marcadores de vazio', () => {
    expect(isEmptyValue('')).toBe(true);
    // Só espaços conta como vazio: o trim acontece antes da comparação.
    expect(isEmptyValue('  ')).toBe(true);
    expect(isEmptyValue('-')).toBe(true);
    expect(isEmptyValue('#N/A')).toBe(true);
    expect(isEmptyValue('alta')).toBe(false);
  });

  it('normaliza texto', () => {
    expect(toText('  alta temporada ')).toBe('alta temporada');
    expect(toText('-')).toBeNull();
  });
});
