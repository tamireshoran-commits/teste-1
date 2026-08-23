import { env } from '@/server/config/env';
import { getLLMProvider, getStorageProvider } from '@/server/core/providers/registry';
import type { LLMProvider } from '@/server/core/providers/ai/llm/LLMProvider';
import { MockLLMProvider } from '@/server/core/providers/ai/llm/MockLLMProvider';
import { logger } from '@/server/core/shared/logger';
import { GrowthMockLLMProvider } from './ai/GrowthMockLLMProvider';
import { MetaGraphClient } from './social/MetaGraphClient';
import { MetaSocialProvider } from './social/MetaSocialProvider';
import { MockSocialProvider } from './social/MockSocialProvider';
import type { SocialMessenger, SocialPublisher } from './social/SocialProvider';
import {
  ExternalSpeechProvider,
  ExternalVideoProvider,
} from './media/ExternalMediaProviders';
import { GeminiImageProvider } from './media/GeminiImageProvider';
import { OpenAICompatibleImageProvider } from './media/OpenAICompatibleImageProvider';
import type {
  ImageProvider,
  SpeechProvider,
  VideoProvider,
} from './media/MediaProvider';
import {
  MockImageProvider,
  MockSpeechProvider,
  MockVideoProvider,
} from './media/MockMediaProviders';

const log = logger.child('growth-registry');

/**
 * Fábrica de providers do Growth Engine.
 *
 * Mesmo princípio do registry do módulo de análise: este é o único arquivo que
 * conhece implementações concretas. O resto do sistema depende das interfaces,
 * então trocar de fornecedor — ou rodar tudo simulado enquanto a Meta não
 * aprova o app — é mudar uma variável de ambiente.
 */

/**
 * Modelo de linguagem dos agentes.
 *
 * Envolve o registry do núcleo por um motivo: o `MockLLMProvider` genérico
 * falha sem resposta registrada, o que travaria todo o pipeline de vendas em
 * quem ainda não configurou chave de API. Aqui o mock é o do Growth Engine,
 * que devolve conteúdo simulado e explicitamente rotulado.
 *
 * A troca acontece também quando o provider real cai para o mock por falta de
 * credencial — é o mesmo caso, com outro caminho de configuração.
 */
export function getGrowthLLMProvider(
  choice: typeof env.LLM_PROVIDER = env.LLM_PROVIDER,
): LLMProvider {
  if (choice === 'MOCK') return new GrowthMockLLMProvider();

  const provider = getLLMProvider(choice);

  return provider instanceof MockLLMProvider
    ? new GrowthMockLLMProvider()
    : provider;
}

function buildMetaProvider(): MetaSocialProvider {
  return new MetaSocialProvider(
    new MetaGraphClient({ version: env.META_GRAPH_VERSION }),
  );
}

export function getSocialPublisher(
  choice: typeof env.SOCIAL_PROVIDER = env.SOCIAL_PROVIDER,
): SocialPublisher {
  return choice === 'META' ? buildMetaProvider() : new MockSocialProvider();
}

export function getSocialMessenger(
  choice: typeof env.SOCIAL_PROVIDER = env.SOCIAL_PROVIDER,
): SocialMessenger {
  return choice === 'META' ? buildMetaProvider() : new MockSocialProvider();
}

export function getImageProvider(
  choice: typeof env.IMAGE_PROVIDER = env.IMAGE_PROVIDER,
): ImageProvider {
  const storage = getStorageProvider();

  if (choice === 'OPENAI_COMPATIBLE') {
    const baseUrl = env.LLM_BASE_URL?.trim();
    const apiKey = env.LLM_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || 'local';

    if (!baseUrl) {
      log.warn(
        'IMAGE_PROVIDER=OPENAI_COMPATIBLE exige LLM_BASE_URL; usando o ' +
          'gerador simulado. As imagens saem marcadas como exemplo.',
      );
      return new MockImageProvider(storage);
    }

    return new OpenAICompatibleImageProvider(storage, {
      baseUrl,
      apiKey,
      model: env.IMAGE_MODEL,
      label: 'gateway',
    });
  }

  if (choice === 'GEMINI') {
    const apiKey = env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      log.warn(
        'IMAGE_PROVIDER=GEMINI mas GEMINI_API_KEY não está configurada; ' +
          'usando o gerador simulado. As imagens saem marcadas como exemplo.',
      );
      return new MockImageProvider(storage);
    }

    return new GeminiImageProvider(storage, {
      apiKey,
      model: env.IMAGE_MODEL,
    });
  }

  return new MockImageProvider(storage);
}

export function getVideoProvider(
  choice: typeof env.VIDEO_PROVIDER = env.VIDEO_PROVIDER,
): VideoProvider {
  return choice === 'EXTERNAL'
    ? new ExternalVideoProvider()
    : new MockVideoProvider(getStorageProvider());
}

export function getSpeechProvider(
  choice: typeof env.TTS_PROVIDER = env.TTS_PROVIDER,
): SpeechProvider {
  return choice === 'EXTERNAL'
    ? new ExternalSpeechProvider()
    : new MockSpeechProvider(getStorageProvider());
}
