import type { ImageInput, PhotoAnalysisResult } from '@/server/core/types';

/**
 * Contrato de análise visual.
 *
 * Uma imagem por chamada, sempre: lotes grandes estouram limite de tamanho, e
 * a falha de uma foto derrubaria as outras. O paralelismo é responsabilidade
 * do `ImageAnalysisService`, não do provider.
 */
export interface VisionProvider {
  readonly name: string;
  readonly model: string;

  isAvailable(): Promise<boolean>;

  /**
   * Analisa UMA imagem.
   *
   * Deve lançar erros do domínio (`RateLimitError`, `TimeoutError`,
   * `InvalidInputError`, `ProviderError`) para que o retry saiba o que é
   * transitório e o que não é.
   */
  analyzeImage(
    image: ImageInput,
    options?: VisionAnalyzeOptions,
  ): Promise<VisionAnalyzeOutput>;
}

export interface VisionAnalyzeOptions {
  /** Prompt já resolvido pelo PromptRegistry. */
  prompt?: string;
  promptVersion?: string;
  timeoutMs?: number;
  /** Contexto do imóvel, para a IA julgar o ambiente com mais precisão. */
  propertyContext?: {
    propertyType?: string;
    bedrooms?: number;
    city?: string;
  };
}

export interface VisionAnalyzeOutput {
  result: Omit<PhotoAnalysisResult, 'provider' | 'model' | 'fromCache'>;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    imageCount: number;
  };
  raw?: unknown;
}
