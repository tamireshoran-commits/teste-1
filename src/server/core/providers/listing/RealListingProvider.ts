import { ProviderUnavailableError } from '@/server/core/shared/errors';
import type { ListingData } from '@/server/core/types';
import type {
  AirbnbDataProvider,
  BookingDataProvider,
  ListingFetchInput,
} from './ListingDataProvider';

/**
 * Pontos de extensão para as integrações oficiais.
 *
 * Nenhum dos dois faz scraping, e não devem passar a fazer: os Termos de
 * Serviço do Airbnb e do Booking.com proíbem coleta automatizada. A
 * implementação real depende de acesso concedido pela plataforma — parceria,
 * programa de parceiros ou API oficial.
 *
 * Enquanto isso não existe, estas classes declaram indisponibilidade em vez
 * de devolver dado inventado. É o mesmo padrão do `PriceLabsAPIProvider`.
 */

export class RealAirbnbProvider implements AirbnbDataProvider {
  readonly platform = 'AIRBNB' as const;
  readonly name = 'RealAirbnbProvider';
  readonly producesMockData = false;

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async fetchListing(_input: ListingFetchInput): Promise<ListingData> {
    throw new ProviderUnavailableError(
      this.name,
      'não há integração oficial disponível com o Airbnb. Os Termos de ' +
        'Serviço proíbem coleta automatizada, então esta integração depende ' +
        'de acesso concedido pela plataforma. Use AIRBNB_PROVIDER=MANUAL.',
    );
  }
}

export class RealBookingProvider implements BookingDataProvider {
  readonly platform = 'BOOKING' as const;
  readonly name = 'RealBookingProvider';
  readonly producesMockData = false;

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async fetchListing(_input: ListingFetchInput): Promise<ListingData> {
    throw new ProviderUnavailableError(
      this.name,
      'a API de parceiros do Booking.com exige contrato e credenciais que ' +
        'não temos. Use BOOKING_PROVIDER=MANUAL.',
    );
  }
}
