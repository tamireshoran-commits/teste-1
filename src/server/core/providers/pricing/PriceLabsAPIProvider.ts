import { ProviderUnavailableError } from '@/server/core/shared/errors';
import type { PricingDataset, PricingSourceName } from '@/server/core/types';
import type {
  PricingDataProvider,
  PricingLoadInput,
} from './PricingDataProvider';

/**
 * Ponto de extensão para a API do PriceLabs.
 *
 * A API do PriceLabs exige credenciais e habilitação na conta do cliente, que
 * não temos. Em vez de fingir uma integração ou inventar endpoints, este
 * provider declara explicitamente que está indisponível.
 *
 * Para implementar quando as credenciais existirem:
 *   1. adicionar `PRICELABS_API_KEY` em `config/env.ts`;
 *   2. implementar `load()` chamando o endpoint documentado pelo PriceLabs;
 *   3. mapear a resposta para `PricingDataset` (mesmo DTO do CSV);
 *   4. trocar `PRICING_PROVIDER=PRICELABS_API` no ambiente.
 *
 * Nada fora desta pasta muda.
 */
export class PriceLabsAPIProvider implements PricingDataProvider {
  readonly source: PricingSourceName = 'PRICELABS_API';
  readonly name = 'PriceLabsAPIProvider';

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async load(_input: PricingLoadInput): Promise<PricingDataset> {
    throw new ProviderUnavailableError(
      this.name,
      'a integração com a API do PriceLabs exige credenciais e habilitação ' +
        'na conta do cliente. Use a exportação em CSV (CSV_PRICELABS) até que ' +
        'o acesso esteja disponível.',
    );
  }
}
