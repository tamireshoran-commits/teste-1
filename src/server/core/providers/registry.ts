import { env } from '@/server/config/env';
import { AppError } from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';
import { GeminiLLMProvider } from './ai/llm/GeminiLLMProvider';
import type { LLMProvider } from './ai/llm/LLMProvider';
import { MockLLMProvider } from './ai/llm/MockLLMProvider';
import { GeminiVisionProvider } from './ai/vision/GeminiVisionProvider';
import { MockVisionProvider } from './ai/vision/MockVisionProvider';
import type { VisionProvider } from './ai/vision/VisionProvider';
import type {
  AirbnbDataProvider,
  BookingDataProvider,
} from './listing/ListingDataProvider';
import {
  MockAirbnbProvider,
  MockBookingProvider,
} from './listing/MockListingProvider';
import {
  ManualAirbnbProvider,
  ManualBookingProvider,
} from './listing/ManualListingProvider';
import { CSVPriceLabsProvider } from './pricing/CSVPriceLabsProvider';
import { PriceLabsAPIProvider } from './pricing/PriceLabsAPIProvider';
import type { PricingDataProvider } from './pricing/PricingDataProvider';
import { LocalStorageProvider } from './storage/LocalStorageProvider';
import type { StorageProvider } from './storage/StorageProvider';

const log = logger.child('provider-registry');

/**
 * Fábrica de providers.
 *
 * Único ponto do sistema que decide qual implementação concreta usar. Todo o
 * resto depende apenas das interfaces, então trocar de fornecedor é mudar uma
 * variável de ambiente.
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

/**
 * Resolve o provider de visão, com **fallback automático para o mock**.
 *
 * Pedir GEMINI sem `GEMINI_API_KEY` configurada não derruba a aplicação: cai
 * para o mock com um aviso no log. Isso mantém o ambiente de desenvolvimento
 * funcional para quem clonou o repositório sem credencial, e é por isso que o
 * resultado carrega `provider: "mock"` — o consumidor precisa saber que aquilo
 * é simulado e rotular na interface.
 */
export function getVisionProvider(
  choice: typeof env.VISION_PROVIDER = env.VISION_PROVIDER,
): VisionProvider {
  if (choice === 'MOCK') return new MockVisionProvider();

  if (choice === 'GEMINI') {
    const apiKey = env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      log.warn(
        'VISION_PROVIDER=GEMINI mas GEMINI_API_KEY não está configurada; ' +
          'usando MockVisionProvider. Os resultados são simulados.',
      );
      return new MockVisionProvider();
    }

    return new GeminiVisionProvider({ apiKey, model: env.VISION_MODEL });
  }

  // ANTHROPIC e OPENAI: contrato pronto, implementação nas próximas etapas.
  log.warn(
    `VISION_PROVIDER=${choice} ainda não tem implementação; ` +
      'usando MockVisionProvider. Os resultados são simulados.',
  );

  return new MockVisionProvider();
}

/**
 * Resolve o provider de texto, com o mesmo fallback do de visão.
 *
 * O mock **não improvisa conteúdo**: sem resposta registrada ele falha, e o
 * `ListingAnalysisService` trata isso como enriquecimento indisponível e
 * entrega só as regras determinísticas.
 */
export function getLLMProvider(
  choice: typeof env.LLM_PROVIDER = env.LLM_PROVIDER,
): LLMProvider {
  if (choice === 'MOCK') return new MockLLMProvider();

  if (choice === 'GEMINI') {
    const apiKey = env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      log.warn(
        'LLM_PROVIDER=GEMINI mas GEMINI_API_KEY não está configurada; ' +
          'a análise qualitativa será pulada.',
      );
      return new MockLLMProvider();
    }

    return new GeminiLLMProvider({
      apiKey,
      cheapModel: env.LLM_MODEL_CHEAP,
      smartModel: env.LLM_MODEL_SMART,
    });
  }

  log.warn(
    `LLM_PROVIDER=${choice} ainda não tem implementação; ` +
      'a análise qualitativa será pulada.',
  );

  return new MockLLMProvider();
}

/**
 * Providers de anúncio.
 *
 * `MANUAL` é o caminho de produção do MVP: o dono informa os dados do próprio
 * anúncio. `MOCK` serve para desenvolver a interface, e tudo que ele devolve
 * vem com `isMock: true` e textos prefixados com "[EXEMPLO]".
 *
 * `RealAirbnbProvider`/`RealBookingProvider` existem em
 * `listing/RealListingProvider.ts` e declaram indisponibilidade — não estão
 * no switch porque não há env que os selecione enquanto não houver acesso
 * concedido pelas plataformas.
 */
export function getAirbnbProvider(
  choice: typeof env.AIRBNB_PROVIDER = env.AIRBNB_PROVIDER,
): AirbnbDataProvider {
  return choice === 'MANUAL'
    ? new ManualAirbnbProvider()
    : new MockAirbnbProvider();
}

export function getBookingProvider(
  choice: typeof env.BOOKING_PROVIDER = env.BOOKING_PROVIDER,
): BookingDataProvider {
  return choice === 'MANUAL'
    ? new ManualBookingProvider()
    : new MockBookingProvider();
}

export function getStorageProvider(
  choice: typeof env.STORAGE_PROVIDER = env.STORAGE_PROVIDER,
): StorageProvider {
  if (choice === 'S3') {
    log.warn(
      'STORAGE_PROVIDER=S3 ainda não tem implementação; usando disco local.',
    );
  }

  return new LocalStorageProvider(env.STORAGE_LOCAL_DIR);
}
