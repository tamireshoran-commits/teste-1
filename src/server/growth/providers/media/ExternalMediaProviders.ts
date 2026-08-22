import { ProviderUnavailableError } from '@/server/core/shared/errors';
import type {
  GeneratedMedia,
  SpeechGenerationInput,
  SpeechProvider,
  VideoGenerationInput,
  VideoProvider,
} from './MediaProvider';

/**
 * Pontos de extensão para geração de vídeo e voz.
 *
 * Não há implementação porque não há padrão: cada fornecedor de vídeo tem um
 * formato de requisição, um modelo de polling e uma política de direitos
 * diferente, e escolher um hoje seria acoplar o sistema a uma aposta.
 *
 * O que já está pronto é tudo que vem antes e depois: o Agente 3 entrega o
 * briefing cena a cena, o `MediaAsset` tem onde guardar o resultado e a fila
 * sabe retentar. Integrar um fornecedor é implementar `VideoProvider` e mudar
 * `VIDEO_PROVIDER` — nada fora desta pasta muda.
 *
 * Enquanto isso, declaram indisponibilidade em vez de devolver mídia falsa —
 * mesmo padrão de `RealAirbnbProvider` e `PriceLabsAPIProvider`.
 */

export class ExternalVideoProvider implements VideoProvider {
  readonly name = 'external-video';

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async generateVideo(_input: VideoGenerationInput): Promise<GeneratedMedia> {
    throw new ProviderUnavailableError(
      this.name,
      'nenhuma API de geração de vídeo está integrada. Implemente ' +
        '`VideoProvider` com o fornecedor escolhido, ou use ' +
        'VIDEO_PROVIDER=MOCK para produzir o storyboard e gravar o vídeo ' +
        'manualmente.',
    );
  }
}

export class ExternalSpeechProvider implements SpeechProvider {
  readonly name = 'external-speech';

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async generateSpeech(_input: SpeechGenerationInput): Promise<GeneratedMedia> {
    throw new ProviderUnavailableError(
      this.name,
      'nenhuma API de síntese de voz está integrada. Implemente ' +
        '`SpeechProvider`, ou use TTS_PROVIDER=MOCK para receber o roteiro de ' +
        'narração pronto para gravação.',
    );
  }
}
