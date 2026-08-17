import { describe, expect, it } from 'vitest';
import {
  detectDelimiter,
  parseCsvText,
  stripBom,
  tokenizeCsv,
} from '@/server/core/providers/pricing/csv/tokenizer';

describe('stripBom', () => {
  it('remove o BOM UTF-8', () => {
    expect(stripBom('﻿date,price')).toBe('date,price');
    expect(stripBom('date,price')).toBe('date,price');
  });
});

describe('detectDelimiter', () => {
  it('detecta vírgula', () => {
    expect(detectDelimiter('date,price,occupancy\n2026-01-01,100,0.8')).toBe(',');
  });

  it('detecta ponto e vírgula', () => {
    expect(detectDelimiter('date;price;occupancy\n2026-01-01;100;0,8')).toBe(';');
  });

  it('detecta tabulação', () => {
    expect(detectDelimiter('date\tprice\tocc')).toBe('\t');
  });

  it('ignora delimitadores dentro de aspas', () => {
    // A vírgula está dentro de aspas; o ; é o delimitador real.
    expect(detectDelimiter('date;"Rio, RJ";price')).toBe(';');
  });

  it('cai para vírgula quando não há delimitador', () => {
    expect(detectDelimiter('coluna_unica')).toBe(',');
  });
});

describe('tokenizeCsv', () => {
  it('divide linhas e campos simples', () => {
    const rows = tokenizeCsv('a,b\n1,2\n3,4', ',');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('respeita campos entre aspas com o delimitador dentro', () => {
    const rows = tokenizeCsv('name,city\n"Casa, azul","Rio de Janeiro"', ',');
    expect(rows[1]).toEqual(['Casa, azul', 'Rio de Janeiro']);
  });

  it('interpreta aspas escapadas', () => {
    const rows = tokenizeCsv('a\n"diz ""oi"""', ',');
    expect(rows[1]).toEqual(['diz "oi"']);
  });

  it('aceita quebra de linha dentro de campo entre aspas', () => {
    const rows = tokenizeCsv('a,b\n"linha1\nlinha2",x', ',');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(['linha1\nlinha2', 'x']);
  });

  it('trata CRLF', () => {
    const rows = tokenizeCsv('a,b\r\n1,2\r\n', ',');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('descarta linhas totalmente vazias', () => {
    const rows = tokenizeCsv('a,b\n\n1,2\n,\n', ',');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('captura a última linha sem quebra final', () => {
    const rows = tokenizeCsv('a,b\n1,2', ',');
    expect(rows[1]).toEqual(['1', '2']);
  });
});

describe('parseCsvText', () => {
  it('combina BOM, detecção de delimitador e tokenização', () => {
    const { rows, delimiter } = parseCsvText('﻿date;price\n2026-01-01;100');
    expect(delimiter).toBe(';');
    expect(rows[0]).toEqual(['date', 'price']);
    expect(rows[1]).toEqual(['2026-01-01', '100']);
  });
});
