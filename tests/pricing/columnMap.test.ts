import { describe, expect, it } from 'vitest';
import {
  buildColumnMapping,
  normalizeHeader,
} from '@/server/core/providers/pricing/csv/columnMap';

describe('normalizeHeader', () => {
  it('remove acentos, pontuação e normaliza para snake_case', () => {
    expect(normalizeHeader('Preço Recomendado')).toBe('preco_recomendado');
    expect(normalizeHeader('  Data  ')).toBe('data');
    expect(normalizeHeader('Min Price (R$)')).toBe('min_price_r');
    expect(normalizeHeader('ADR')).toBe('adr');
  });
});

describe('buildColumnMapping', () => {
  it('mapeia headers em inglês', () => {
    const mapping = buildColumnMapping([
      'Date',
      'Price',
      'Recommended Price',
      'Min Price',
      'Max Price',
      'Occupancy',
    ]);

    expect(mapping.indexByField.date).toBe(0);
    expect(mapping.indexByField.price).toBe(1);
    expect(mapping.indexByField.recommendedPrice).toBe(2);
    expect(mapping.indexByField.minPrice).toBe(3);
    expect(mapping.indexByField.maxPrice).toBe(4);
    expect(mapping.indexByField.occupancy).toBe(5);
  });

  it('mapeia headers em português', () => {
    const mapping = buildColumnMapping([
      'Data',
      'Preço',
      'Preço Recomendado',
      'Ocupação',
      'Estadia Mínima',
    ]);

    expect(mapping.indexByField.date).toBe(0);
    expect(mapping.indexByField.price).toBe(1);
    expect(mapping.indexByField.recommendedPrice).toBe(2);
    expect(mapping.indexByField.occupancy).toBe(3);
    expect(mapping.indexByField.minStay).toBe(4);
  });

  it('não deixa o alias genérico "price" roubar "recommended price"', () => {
    // Regressão: a passada de igualdade exata precisa rodar antes da de
    // "contém", senão "Recommended Price" casaria com o campo `price`.
    const mapping = buildColumnMapping(['Date', 'Recommended Price', 'Price']);

    expect(mapping.indexByField.recommendedPrice).toBe(1);
    expect(mapping.indexByField.price).toBe(2);
  });

  it('funciona com a ordem das colunas trocada', () => {
    const mapping = buildColumnMapping(['Occupancy', 'Price', 'Date']);

    expect(mapping.indexByField.date).toBe(2);
    expect(mapping.indexByField.price).toBe(1);
    expect(mapping.indexByField.occupancy).toBe(0);
  });

  it('nunca atribui a mesma coluna a dois campos', () => {
    const mapping = buildColumnMapping(['Date', 'Price', 'Min Price']);
    const indexes = Object.values(mapping.indexByField);

    expect(new Set(indexes).size).toBe(indexes.length);
  });

  it('reporta headers não reconhecidos', () => {
    const mapping = buildColumnMapping(['Date', 'Price', 'Coluna Estranha']);

    expect(mapping.unmappedHeaders).toEqual(['Coluna Estranha']);
  });

  it('registra o mapeamento header -> campo para auditoria', () => {
    const mapping = buildColumnMapping(['Data', 'Preço']);

    expect(mapping.headerToField).toEqual({ Data: 'date', 'Preço': 'price' });
  });

  it('não casa alias curto dentro de outra palavra', () => {
    // "adr" não pode casar com "Quadra".
    const mapping = buildColumnMapping(['Date', 'Quadra']);
    expect(mapping.indexByField.adr).toBeUndefined();
  });
});
