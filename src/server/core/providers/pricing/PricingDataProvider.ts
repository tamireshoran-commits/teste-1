import type { PricingDataset, PricingSourceName } from '@/server/core/types';

/**
 * Contrato de origem dos dados de pricing.
 *
 * No MVP a única implementação utilizável é o CSV exportado do PriceLabs.
 * A integração via API fica atrás do mesmo contrato para entrar depois sem
 * mexer na análise.
 */
export interface PricingDataProvider {
  readonly source: PricingSourceName;
  readonly name: string;

  isAvailable(): Promise<boolean>;

  load(input: PricingLoadInput): Promise<PricingDataset>;
}

export type PricingLoadInput =
  | {
      kind: 'csv';
      /** Conteúdo do arquivo já decodificado como texto. */
      content: string;
      fileName?: string;
    }
  | {
      kind: 'api';
      listingId: string;
      dateFrom?: string;
      dateTo?: string;
    };
