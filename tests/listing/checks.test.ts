import { describe, expect, it } from 'vitest';
import {
  matchAmenities,
  normalizeAmenity,
} from '@/server/core/analysis/listing/amenities';
import {
  normalizeRating,
  runListingChecks,
} from '@/server/core/analysis/listing/checks';
import type { ListingData, Platform } from '@/server/core/types';

function listing(
  overrides: Partial<ListingData> = {},
  platform: Platform = 'AIRBNB',
): ListingData {
  return {
    platform,
    source: 'MANUAL',
    isMock: false,
    capturedAt: new Date().toISOString(),
    amenities: [],
    houseRules: [],
    photos: [],
    ...overrides,
  };
}

const codes = (l: ListingData) => runListingChecks(l).findings.map((f) => f.code);

describe('matchAmenities', () => {
  it('casa comodidades escritas de formas diferentes', () => {
    const result = matchAmenities([
      'Wi-Fi gratuito de alta velocidade',
      'AR CONDICIONADO',
      'Cozinha equipada',
    ]);

    const keys = result.present.map((a) => a.key);
    expect(keys).toContain('wifi');
    expect(keys).toContain('ac');
    expect(keys).toContain('kitchen');
  });

  it('casa em português e em inglês', () => {
    expect(matchAmenities(['Washing machine']).present.map((a) => a.key)).toContain(
      'washer',
    );
    expect(matchAmenities(['Máquina de lavar']).present.map((a) => a.key)).toContain(
      'washer',
    );
  });

  it('reporta as ausentes por camada', () => {
    const result = matchAmenities(['Wi-Fi']);

    const missingKeys = result.missing.map((a) => a.key);
    expect(missingKeys).toContain('kitchen');
    expect(missingKeys).not.toContain('wifi');
  });

  it('lista comodidades fora do catálogo como extras', () => {
    const result = matchAmenities(['Adega climatizada']);
    expect(result.extra).toContain('Adega climatizada');
  });

  it('normaliza acentos e pontuação', () => {
    expect(normalizeAmenity('Ar-Condicionado')).toBe('ar condicionado');
    expect(normalizeAmenity('  Espaço  de Trabalho ')).toBe('espaco de trabalho');
  });

  it('lida com lista vazia', () => {
    const result = matchAmenities([]);
    expect(result.present).toEqual([]);
    expect(result.missing.length).toBeGreaterThan(0);
  });
});

describe('normalizeRating', () => {
  it('converte a escala de cada plataforma para 0-100', () => {
    expect(normalizeRating('AIRBNB', 5)).toBe(100);
    expect(normalizeRating('AIRBNB', 4.5)).toBe(90);
    expect(normalizeRating('BOOKING', 10)).toBe(100);
    expect(normalizeRating('BOOKING', 8.5)).toBe(85);
  });

  it('devolve null quando não há nota', () => {
    expect(normalizeRating('AIRBNB', undefined)).toBeNull();
  });
});

describe('runListingChecks — título e descrição', () => {
  it('sinaliza título ausente como problema alto', () => {
    expect(codes(listing())).toContain('TITLE_MISSING');
  });

  it('sinaliza título curto', () => {
    expect(codes(listing({ title: 'Casa' }))).toContain('TITLE_TOO_SHORT');
  });

  it('sinaliza título longo demais', () => {
    expect(codes(listing({ title: 'A'.repeat(120) }))).toContain('TITLE_TOO_LONG');
  });

  it('sinaliza título todo em maiúsculas', () => {
    expect(
      codes(listing({ title: 'CASA COM PISCINA NA PRAIA GRANDE' })),
    ).toContain('TITLE_ALL_CAPS');
  });

  it('não reclama de título com tamanho adequado', () => {
    const found = codes(
      listing({ title: 'Apartamento 2 quartos a 200m da praia central' }),
    );

    expect(found).not.toContain('TITLE_TOO_SHORT');
    expect(found).not.toContain('TITLE_TOO_LONG');
  });

  it('sinaliza descrição curta e ausente', () => {
    expect(codes(listing())).toContain('DESCRIPTION_MISSING');
    expect(codes(listing({ description: 'Casa boa.' }))).toContain(
      'DESCRIPTION_TOO_SHORT',
    );
  });

  it('registra descrição detalhada como ponto forte', () => {
    const checks = runListingChecks(listing({ description: 'x'.repeat(700) }));
    expect(checks.strengths).toContain('Descrição detalhada');
  });
});

describe('runListingChecks — comodidades e fotos', () => {
  it('sinaliza essenciais faltando', () => {
    expect(codes(listing({ amenities: ['Piscina'] }))).toContain(
      'MISSING_ESSENTIAL_AMENITIES',
    );
  });

  it('não sinaliza essenciais quando todas estão declaradas', () => {
    const found = codes(
      listing({
        amenities: ['Wi-Fi', 'Cozinha', 'Roupa de cama', 'Toalhas'],
      }),
    );

    expect(found).not.toContain('MISSING_ESSENTIAL_AMENITIES');
  });

  it('sinaliza ausência total de fotos', () => {
    expect(codes(listing())).toContain('NO_PHOTOS');
  });

  it('sinaliza poucas fotos, com severidade proporcional', () => {
    const poucas = runListingChecks(
      listing({ photos: [{ position: 0 }, { position: 1 }] }),
    ).findings.find((f) => f.code === 'FEW_PHOTOS');

    expect(poucas?.severity).toBe('HIGH');

    const quase = runListingChecks(
      listing({
        photos: Array.from({ length: 8 }, (_u, i) => ({ position: i })),
      }),
    ).findings.find((f) => f.code === 'FEW_PHOTOS');

    expect(quase?.severity).toBe('MEDIUM');
  });

  it('não reclama de quantidade adequada de fotos', () => {
    const found = codes(
      listing({ photos: Array.from({ length: 16 }, (_u, i) => ({ position: i })) }),
    );

    expect(found).not.toContain('FEW_PHOTOS');
  });
});

describe('runListingChecks — reputação', () => {
  it('sinaliza ausência de avaliações', () => {
    expect(codes(listing({ reviewCount: 0 }))).toContain('NO_REVIEWS');
  });

  it('sinaliza poucas avaliações', () => {
    expect(codes(listing({ reviewCount: 4 }))).toContain('FEW_REVIEWS');
  });

  it('sinaliza nota baixa apenas com volume que a sustente', () => {
    // Com 3 avaliações a nota ainda oscila; não acusamos nota baixa.
    expect(codes(listing({ rating: 3.5, reviewCount: 3 }))).not.toContain(
      'LOW_RATING',
    );
    expect(codes(listing({ rating: 3.5, reviewCount: 50 }))).toContain(
      'LOW_RATING',
    );
  });

  it('reconhece reputação sólida como ponto forte', () => {
    const checks = runListingChecks(listing({ rating: 4.9, reviewCount: 120 }));
    expect(checks.strengths.some((s) => s.includes('Reputação sólida'))).toBe(true);
  });

  it('sinaliza temas negativos recorrentes', () => {
    const found = codes(
      listing({
        reviewHighlights: { positive: [], negative: ['Barulho', 'Limpeza'] },
      }),
    );

    expect(found).toContain('RECURRING_NEGATIVES');
  });
});

describe('runListingChecks — políticas', () => {
  it('sinaliza política restritiva em ambas as plataformas', () => {
    expect(codes(listing({ cancellationPolicy: 'Rigorosa' }))).toContain(
      'STRICT_CANCELLATION',
    );
    expect(
      codes(listing({ cancellationPolicy: 'Não reembolsável' }, 'BOOKING')),
    ).toContain('STRICT_CANCELLATION');
  });

  it('não reclama de política flexível', () => {
    expect(codes(listing({ cancellationPolicy: 'Flexível' }))).not.toContain(
      'STRICT_CANCELLATION',
    );
  });

  it('sinaliza excesso de regras', () => {
    expect(
      codes(listing({ houseRules: Array.from({ length: 9 }, (_u, i) => `Regra ${i}`) })),
    ).toContain('MANY_HOUSE_RULES');
  });

  it('sinaliza estadia mínima alta', () => {
    expect(codes(listing({ minimumStay: 7 }))).toContain('HIGH_MINIMUM_STAY');
    expect(codes(listing({ minimumStay: 2 }))).not.toContain('HIGH_MINIMUM_STAY');
  });
});

describe('runListingChecks — campos ausentes', () => {
  it('lista tudo que não foi informado', () => {
    const checks = runListingChecks(listing());

    for (const campo of [
      'Título do anúncio',
      'Descrição do anúncio',
      'Tipo do imóvel',
      'Número de quartos',
      'Política de cancelamento',
      'Regras da casa',
    ]) {
      expect(checks.missingInfo).toContain(campo);
    }
  });

  it('não lista o que foi informado', () => {
    const checks = runListingChecks(
      listing({ title: 'Casa boa na praia com vista', bedrooms: 2 }),
    );

    expect(checks.missingInfo).not.toContain('Título do anúncio');
    expect(checks.missingInfo).not.toContain('Número de quartos');
  });
});

describe('runListingChecks — específicos de plataforma', () => {
  it('reconhece sinais do Airbnb', () => {
    const checks = runListingChecks(
      listing({ isSuperhost: true, instantBook: true }),
    );

    expect(checks.strengths).toContain('Selo de Superhost');
    expect(checks.strengths).toContain('Reserva instantânea ativa');
  });

  it('sinaliza reserva instantânea desligada', () => {
    expect(codes(listing({ instantBook: false }))).toContain('NO_INSTANT_BOOK');
  });

  it('cobra tipos de quarto no Booking', () => {
    expect(codes(listing({}, 'BOOKING'))).toContain('NO_ROOM_TYPES');
  });

  it('não cobra tipos de quarto no Airbnb', () => {
    expect(codes(listing())).not.toContain('NO_ROOM_TYPES');
  });

  it('reconhece café da manhã incluído no Booking', () => {
    const checks = runListingChecks(
      listing({ breakfastIncluded: true, roomTypes: ['Duplo'] }, 'BOOKING'),
    );

    expect(checks.strengths).toContain('Café da manhã incluído');
  });
});
