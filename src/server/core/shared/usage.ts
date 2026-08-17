/**
 * Porta de registro de uso de IA.
 *
 * O domínio precisa registrar tokens e custo, mas não pode conhecer o Prisma.
 * A implementação que grava em `ai_usage_logs` vive em `server/db/`.
 */
export interface AIUsageEntry {
  analysisId?: string;
  provider: string;
  model: string;
  /** Ex.: "photo-analysis", "recommendations". */
  operation: string;
  inputTokens: number;
  outputTokens: number;
  imageCount: number;
  estimatedCostUsd: number;
  latencyMs?: number;
  success: boolean;
  errorCode?: string;
}

export interface AIUsageRecorder {
  record(entry: AIUsageEntry): Promise<void>;
}

/** Descarta os registros. Usado em testes e em execuções sem banco. */
export class NoopUsageRecorder implements AIUsageRecorder {
  readonly entries: AIUsageEntry[] = [];

  async record(entry: AIUsageEntry): Promise<void> {
    this.entries.push(entry);
  }
}
