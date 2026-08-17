import { env } from '@/server/config/env';
import { AppError } from '@/server/core/shared/errors';
import { CSVPriceLabsProvider } from './pricing/CSVPriceLabsProvider';
import { PriceLabsAPIProvider } from './pricing/PriceLabsAPIProvider';
import type { PricingDataProvider } from './pricing/PricingDataProvider';

/**
 * Fábrica de providers.
 *
 * Único ponto do sistema que decide qual implementação concreta usar. Todo o
 * resto depende apenas das interfaces, então trocar de fornecedor é mudar uma
 * variável de ambiente.
 *
 * Etapas seguintes acrescentam aqui `getVisionProvider()`,
 * `getLLMProvider()`, `getListingProvider()` e `getStorageProvider()` —
 * as interfaces já existem em `providers/`, faltam as implementações.
 */

export function getPricingProvider(
  source: typeof env.PRICING_PROVIDER = env.PRICING_PROVIDER,
): PricingDataProvider {
  switch (source) {
    case 'CSV_PRICELABS':
      return new CSVPriceLabsProvider();

    case 'PRICELABS_API':
      // Existe como contrato, mas lança ProviderUnavailableError ao ser usado.
      return new PriceLabsAPIProvider();

    default: {
      const exhaustive: never = source;
      throw new AppError(`Provider de pricing desconhecido: ${exhaustive}`, {
        code: 'VALIDATION_ERROR',
      });
    }
  }
}
