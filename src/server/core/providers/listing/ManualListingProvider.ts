import { ValidationError } from '@/server/core/shared/errors';
import type { ListingData, Platform } from '@/server/core/types';
import type {
  AirbnbDataProvider,
  BookingDataProvider,
  ListingFetchInput,
} from './ListingDataProvider';
import { parseManualListing } from './listingSchema';

/**
 * Dados do anúncio informados pelo próprio dono.
 *
 * É o caminho legítimo do MVP: sem scraping, sem API não autorizada. O usuário
 * preenche um formulário com o que está no painel dele, e a validação em
 * `listingSchema` garante que nada malformado vire diagnóstico.
 */
abstract class ManualListingProvider {
  abstract readonly platform: Platform;
  readonly producesMockData = false;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async fetchListing(input: ListingFetchInput): Promise<ListingData> {
    if (!input.manualData) {
      throw new ValidationError(
        'Nenhum dado foi informado para o anúncio. O preenchimento manual é ' +
          'obrigatório enquanto não houver integração oficial.',
        { platform: this.platform },
      );
    }

    // A URL pode chegar separada do resto do formulário.
    const raw = {
      ...input.manualData,
      ...(input.url !== undefined ? { externalUrl: input.url } : {}),
    };

    return parseManualListing(this.platform, raw);
  }
}

export class ManualAirbnbProvider
  extends ManualListingProvider
  implements AirbnbDataProvider
{
  readonly platform = 'AIRBNB' as const;
  readonly name = 'ManualAirbnbProvider';
}

export class ManualBookingProvider
  extends ManualListingProvider
  implements BookingDataProvider
{
  readonly platform = 'BOOKING' as const;
  readonly name = 'ManualBookingProvider';
}
