import type { ListingData, Platform } from '@/server/core/types';
import type {
  AirbnbDataProvider,
  BookingDataProvider,
  ListingFetchInput,
} from './ListingDataProvider';

/**
 * Anúncios simulados, para desenvolver a interface e os testes sem depender de
 * ninguém preencher formulário.
 *
 * Todo dado devolvido carrega `isMock: true`, e os textos são prefixados com
 * "[EXEMPLO]" — a interface é obrigada a rotular, e nenhum print de tela
 * consegue passar isto por análise real por acidente.
 *
 * A fixture é deliberadamente **imperfeita**: título genérico, descrição curta,
 * comodidades faltando, política rígida. Um mock perfeito daria score alto e
 * esconderia bugs no diagnóstico.
 */

const AIRBNB_FIXTURE: Omit<ListingData, 'capturedAt'> = {
  platform: 'AIRBNB',
  source: 'MOCK',
  isMock: true,
  title: '[EXEMPLO] Apartamento aconchegante',
  description:
    '[EXEMPLO] Apartamento de 2 quartos próximo à praia. Tem wi-fi e ar ' +
    'condicionado. Ideal para famílias.',
  propertyType: 'Apartamento inteiro',
  bedrooms: 2,
  bathrooms: 1,
  beds: 3,
  maxGuests: 5,
  amenities: [
    'Wi-Fi',
    'Ar-condicionado',
    'Cozinha',
    'TV',
    'Roupa de cama',
  ],
  houseRules: [
    'Não é permitido fumar',
    'Não são permitidos animais de estimação',
    'Não são permitidas festas',
    'Silêncio após as 22h',
  ],
  cancellationPolicy: 'Rigorosa',
  checkIn: '15:00',
  checkOut: '11:00',
  minimumStay: 3,
  rating: 4.72,
  reviewCount: 38,
  reviewHighlights: {
    positive: ['[EXEMPLO] Localização', '[EXEMPLO] Limpeza'],
    negative: ['[EXEMPLO] Barulho da rua', '[EXEMPLO] Chuveiro fraco'],
  },
  photos: Array.from({ length: 9 }, (_unused, i) => ({
    position: i,
    caption: `[EXEMPLO] Foto ${i + 1}`,
  })),
  isSuperhost: false,
  instantBook: true,
};

const BOOKING_FIXTURE: Omit<ListingData, 'capturedAt'> = {
  platform: 'BOOKING',
  source: 'MOCK',
  isMock: true,
  title: '[EXEMPLO] Apartamento Beira-Mar 2 Quartos',
  description:
    '[EXEMPLO] Apartamento com 2 quartos a 300 m da praia. Wi-Fi gratuito e ' +
    'ar-condicionado em todos os ambientes.',
  propertyType: 'Apartamento',
  bedrooms: 2,
  bathrooms: 1,
  beds: 3,
  maxGuests: 5,
  amenities: ['Wi-Fi gratuito', 'Ar-condicionado', 'Cozinha', 'TV de tela plana'],
  houseRules: ['Proibido fumar', 'Não são permitidas festas'],
  cancellationPolicy: 'Não reembolsável',
  checkIn: '15:00 - 20:00',
  checkOut: '08:00 - 11:00',
  minimumStay: 2,
  rating: 8.4,
  reviewCount: 112,
  reviewHighlights: {
    positive: ['[EXEMPLO] Localização', '[EXEMPLO] Custo-benefício'],
    negative: ['[EXEMPLO] Café da manhã não incluído'],
  },
  photos: Array.from({ length: 12 }, (_unused, i) => ({
    position: i,
    caption: `[EXEMPLO] Foto ${i + 1}`,
  })),
  roomTypes: ['Apartamento com 2 quartos'],
  breakfastIncluded: false,
};

abstract class MockListingProvider {
  abstract readonly platform: Platform;
  readonly producesMockData = true;

  protected abstract fixture(): Omit<ListingData, 'capturedAt'>;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async fetchListing(input: ListingFetchInput): Promise<ListingData> {
    return {
      ...this.fixture(),
      ...(input.url !== undefined ? { externalUrl: input.url } : {}),
      capturedAt: new Date().toISOString(),
    };
  }
}

export class MockAirbnbProvider
  extends MockListingProvider
  implements AirbnbDataProvider
{
  readonly platform = 'AIRBNB' as const;
  readonly name = 'MockAirbnbProvider';

  protected fixture() {
    return AIRBNB_FIXTURE;
  }
}

export class MockBookingProvider
  extends MockListingProvider
  implements BookingDataProvider
{
  readonly platform = 'BOOKING' as const;
  readonly name = 'MockBookingProvider';

  protected fixture() {
    return BOOKING_FIXTURE;
  }
}
