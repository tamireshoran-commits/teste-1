import { describe, expect, it } from 'vitest';
import {
  ManualAirbnbProvider,
  ManualBookingProvider,
} from '@/server/core/providers/listing/ManualListingProvider';
import {
  MockAirbnbProvider,
  MockBookingProvider,
} from '@/server/core/providers/listing/MockListingProvider';
import {
  RealAirbnbProvider,
  RealBookingProvider,
} from '@/server/core/providers/listing/RealListingProvider';
import {
  ProviderUnavailableError,
  ValidationError,
} from '@/server/core/shared/errors';

describe('Providers manuais', () => {
  it('produzem um DTO válido a partir do formulário', async () => {
    const listing = await new ManualAirbnbProvider().fetchListing({
      manualData: { title: 'Casa na praia', amenities: ['Wi-Fi'] },
    });

    expect(listing.platform).toBe('AIRBNB');
    expect(listing.source).toBe('MANUAL');
    expect(listing.isMock).toBe(false);
    expect(listing.title).toBe('Casa na praia');
  });

  it('mesclam a URL informada separadamente do formulário', async () => {
    const listing = await new ManualAirbnbProvider().fetchListing({
      url: 'https://www.airbnb.com/rooms/999',
      manualData: { title: 'Casa' },
    });

    expect(listing.externalUrl).toBe('https://www.airbnb.com/rooms/999');
  });

  it('exigem dados: sem formulário, falham em vez de inventar', async () => {
    await expect(
      new ManualAirbnbProvider().fetchListing({}),
    ).rejects.toThrow(ValidationError);
  });

  it('propagam erro de validação da entrada', async () => {
    await expect(
      new ManualBookingProvider().fetchListing({
        manualData: { rating: 99 },
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('declaram que não produzem dado simulado', () => {
    expect(new ManualAirbnbProvider().producesMockData).toBe(false);
    expect(new ManualBookingProvider().producesMockData).toBe(false);
  });
});

describe('Providers mock', () => {
  it('marcam todo dado como simulado', async () => {
    for (const provider of [new MockAirbnbProvider(), new MockBookingProvider()]) {
      const listing = await provider.fetchListing({});

      expect(listing.isMock).toBe(true);
      expect(listing.source).toBe('MOCK');
      expect(provider.producesMockData).toBe(true);
    }
  });

  it('prefixam os textos visíveis com [EXEMPLO]', async () => {
    // Um print de tela do mock não pode passar por análise real.
    const listing = await new MockAirbnbProvider().fetchListing({});

    expect(listing.title).toContain('[EXEMPLO]');
    expect(listing.description).toContain('[EXEMPLO]');
    for (const photo of listing.photos) {
      expect(photo.caption).toContain('[EXEMPLO]');
    }
  });

  it('usam a escala de nota correta de cada plataforma', async () => {
    const airbnb = await new MockAirbnbProvider().fetchListing({});
    const booking = await new MockBookingProvider().fetchListing({});

    expect(airbnb.rating).toBeLessThanOrEqual(5);
    expect(booking.rating).toBeGreaterThan(5);
    expect(booking.rating).toBeLessThanOrEqual(10);
  });

  it('a fixture é imperfeita de propósito', async () => {
    // Um mock perfeito daria score alto e esconderia bugs no diagnóstico.
    const listing = await new MockAirbnbProvider().fetchListing({});

    expect(listing.description!.length).toBeLessThan(200);
    expect(listing.photos.length).toBeLessThan(10);
    expect(listing.cancellationPolicy).toBe('Rigorosa');
  });

  it('trazem os campos específicos de cada plataforma', async () => {
    const airbnb = await new MockAirbnbProvider().fetchListing({});
    const booking = await new MockBookingProvider().fetchListing({});

    expect(airbnb.isSuperhost).toBeDefined();
    expect(booking.roomTypes).toBeDefined();
    expect(booking.breakfastIncluded).toBeDefined();
  });
});

describe('Providers reais (stubs)', () => {
  it('declaram indisponibilidade em vez de devolver dado inventado', async () => {
    for (const provider of [new RealAirbnbProvider(), new RealBookingProvider()]) {
      expect(await provider.isAvailable()).toBe(false);

      await expect(provider.fetchListing({})).rejects.toThrow(
        ProviderUnavailableError,
      );
    }
  });

  it('a mensagem explica o que falta e aponta a alternativa', async () => {
    const error = await new RealAirbnbProvider()
      .fetchListing({})
      .catch((e: unknown) => e);

    expect((error as Error).message).toMatch(/Termos de Serviço/i);
    expect((error as Error).message).toMatch(/MANUAL/);
  });

  it('o erro não é retentável — falta acesso, não é falha transitória', async () => {
    const error = await new RealBookingProvider()
      .fetchListing({})
      .catch((e: unknown) => e);

    expect((error as ProviderUnavailableError).retryable).toBe(false);
  });
});
