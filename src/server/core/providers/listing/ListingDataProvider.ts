import type { ListingData, Platform } from '@/server/core/types';

/**
 * Contrato de leitura de um anúncio.
 *
 * Trocar `MockAirbnbProvider` por um `RealAirbnbProvider` no futuro não deve
 * exigir nenhuma alteração fora desta pasta: quem consome recebe sempre
 * `ListingData`.
 */
export interface ListingDataProvider {
  readonly platform: Platform;
  readonly name: string;
  /** Marca dados simulados, para a UI rotular corretamente. */
  readonly producesMockData: boolean;

  /** O provider consegue operar agora (credenciais presentes, etc)? */
  isAvailable(): Promise<boolean>;

  fetchListing(input: ListingFetchInput): Promise<ListingData>;
}

export interface ListingFetchInput {
  /** URL pública do anúncio, quando houver. */
  url?: string;
  /**
   * Dados preenchidos manualmente pelo usuário.
   * É o caminho principal do MVP — sem scraping.
   */
  manualData?: Partial<ListingData>;
  /** Identificador da análise, para logs e cache. */
  analysisId?: string;
}

/** Contrato específico do Airbnb (item 2 da especificação). */
export interface AirbnbDataProvider extends ListingDataProvider {
  readonly platform: 'AIRBNB';
}

/** Contrato específico do Booking.com (item 3 da especificação). */
export interface BookingDataProvider extends ListingDataProvider {
  readonly platform: 'BOOKING';
}
