import { describe, expect, it } from 'vitest';
import { parseManualListing } from '@/server/core/providers/listing/listingSchema';
import { ValidationError } from '@/server/core/shared/errors';

describe('parseManualListing — normalização', () => {
  it('monta o DTO a partir da entrada mínima', () => {
    const listing = parseManualListing('AIRBNB', { title: 'Casa na praia' });

    expect(listing.platform).toBe('AIRBNB');
    expect(listing.source).toBe('MANUAL');
    expect(listing.isMock).toBe(false);
    expect(listing.title).toBe('Casa na praia');
    expect(listing.amenities).toEqual([]);
    expect(listing.photos).toEqual([]);
    expect(listing.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('trata string vazia como campo não preenchido', () => {
    // A diferença entre "não preencheu" e "não tem" alimenta missingInfo.
    const listing = parseManualListing('AIRBNB', {
      title: 'Casa',
      description: '   ',
    });

    expect(listing.description).toBeUndefined();
  });

  it('remove comodidades duplicadas preservando a ordem', () => {
    const listing = parseManualListing('AIRBNB', {
      amenities: ['Wi-Fi', 'TV', 'Wi-Fi', 'Cozinha'],
    });

    expect(listing.amenities).toEqual(['Wi-Fi', 'TV', 'Cozinha']);
  });

  it('ordena as fotos pela posição informada', () => {
    const listing = parseManualListing('AIRBNB', {
      photos: [
        { position: 2, caption: 'c' },
        { position: 0, caption: 'a' },
        { position: 1, caption: 'b' },
      ],
    });

    expect(listing.photos.map((p) => p.caption)).toEqual(['a', 'b', 'c']);
  });

  it('aceita campos específicos do Airbnb', () => {
    const listing = parseManualListing('AIRBNB', {
      isSuperhost: true,
      instantBook: false,
    });

    expect(listing.isSuperhost).toBe(true);
    expect(listing.instantBook).toBe(false);
  });

  it('aceita campos específicos do Booking', () => {
    const listing = parseManualListing('BOOKING', {
      roomTypes: ['Quarto duplo', 'Suíte'],
      breakfastIncluded: true,
    });

    expect(listing.roomTypes).toEqual(['Quarto duplo', 'Suíte']);
    expect(listing.breakfastIncluded).toBe(true);
  });
});

describe('parseManualListing — validação', () => {
  it('aceita URL do Airbnb', () => {
    const listing = parseManualListing('AIRBNB', {
      externalUrl: 'https://www.airbnb.com.br/rooms/12345',
    });

    expect(listing.externalUrl).toContain('airbnb.com.br');
  });

  it('rejeita URL de outra plataforma no campo do Airbnb', () => {
    expect(() =>
      parseManualListing('AIRBNB', {
        externalUrl: 'https://www.booking.com/hotel/br/xyz.html',
      }),
    ).toThrow(ValidationError);
  });

  it('rejeita URL malformada', () => {
    expect(() =>
      parseManualListing('AIRBNB', { externalUrl: 'nao-e-url' }),
    ).toThrow(ValidationError);
  });

  it('respeita a escala de nota de cada plataforma', () => {
    // Airbnb vai até 5; 8.4 seria nota do Booking colada no lugar errado.
    expect(() => parseManualListing('AIRBNB', { rating: 8.4 })).toThrow(
      ValidationError,
    );
    expect(() => parseManualListing('AIRBNB', { rating: 4.8 })).not.toThrow();

    expect(() => parseManualListing('BOOKING', { rating: 8.4 })).not.toThrow();
    expect(() => parseManualListing('BOOKING', { rating: 11 })).toThrow(
      ValidationError,
    );
  });

  it('a mensagem de nota fora de escala nomeia a plataforma e o limite', () => {
    // Caminho único de validação: a mensagem não muda conforme o valor.
    for (const [platform, rating, esperado] of [
      ['AIRBNB', 8.4, /Airbnb vai até 5/],
      ['BOOKING', 11, /Booking\.com vai até 10/],
    ] as const) {
      try {
        parseManualListing(platform, { rating });
        expect.unreachable('deveria ter lançado');
      } catch (error) {
        const issues = (error as ValidationError).context['issues'] as Array<{
          field: string;
          message: string;
        }>;
        expect(issues[0]!.field).toBe('rating');
        expect(issues[0]!.message).toMatch(esperado);
      }
    }
  });

  it('rejeita números negativos onde não fazem sentido', () => {
    expect(() => parseManualListing('AIRBNB', { bedrooms: -1 })).toThrow(
      ValidationError,
    );
    expect(() => parseManualListing('AIRBNB', { reviewCount: -5 })).toThrow(
      ValidationError,
    );
  });

  it('rejeita texto acima do limite', () => {
    expect(() =>
      parseManualListing('AIRBNB', { title: 'x'.repeat(500) }),
    ).toThrow(ValidationError);
  });

  it('reporta qual campo falhou', () => {
    try {
      parseManualListing('AIRBNB', { externalUrl: 'invalido' });
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      const issues = (error as ValidationError).context['issues'] as Array<{
        field: string;
      }>;
      expect(issues[0]!.field).toBe('externalUrl');
    }
  });

  it('converte strings numéricas vindas de formulário HTML', () => {
    const listing = parseManualListing('AIRBNB', {
      bedrooms: '2',
      rating: '4.8',
      reviewCount: '120',
    });

    expect(listing.bedrooms).toBe(2);
    expect(listing.rating).toBeCloseTo(4.8);
    expect(listing.reviewCount).toBe(120);
  });
});
