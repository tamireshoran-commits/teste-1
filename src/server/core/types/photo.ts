import type { ScoreResult } from './common';

/** Imagem entregue a um VisionProvider. */
export interface ImageInput {
  id: string;
  /** Bytes da imagem. O provider decide como codificar (base64, upload, etc). */
  data: Uint8Array;
  mimeType: string;
  fileName?: string;
  sizeBytes: number;
  /** Posição no anúncio (0 = foto de capa). */
  position: number;
  /** sha256 do conteúdo — usado como chave de cache. */
  sha256: string;
}

/**
 * Resultado da análise de uma única foto.
 * Todas as notas são 0..100.
 */
export interface PhotoAnalysisResult {
  photoId: string;
  roomType: string;
  visualQuality: number;
  lighting: number;
  composition: number;
  professionalism: number;
  valuePerception: number;
  clarity: number;
  strengths: string[];
  problems: string[];
  recommendations: string[];
  score: number;
  provider: string;
  model: string;
  fromCache: boolean;
}

/**
 * Falha na análise de UMA foto.
 *
 * O lote inteiro nunca é derrubado por uma imagem — a falha vira este objeto e
 * a análise segue com as demais.
 */
export interface PhotoAnalysisFailure {
  photoId: string;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
}

export interface PhotoBatchResult {
  results: PhotoAnalysisResult[];
  failures: PhotoAnalysisFailure[];
  totalRequested: number;
  cacheHits: number;
  estimatedCostUsd: number;
}

/** Achados que só existem olhando o conjunto de fotos, não uma isolada. */
export interface PhotoSetInsights {
  bestPhotoId: string | null;
  worstPhotoId: string | null;
  /** Foto que deveria assumir a capa, se diferente da atual. */
  suggestedCoverPhotoId: string | null;
  redundantPhotoIds: string[];
  /** Ambientes presentes nas fotos. */
  coveredRooms: string[];
  /** Ambientes esperados que nenhuma foto cobre. */
  missingRooms: string[];
  /** Ambientes cobertos apenas por fotos de nota baixa. */
  weaklyCoveredRooms: string[];
}

export interface PhotoAnalysisSummary {
  score: ScoreResult;
  insights: PhotoSetInsights;
  perPhoto: PhotoAnalysisResult[];
  failures: PhotoAnalysisFailure[];
}
