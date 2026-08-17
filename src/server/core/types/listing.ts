import type { Finding, ListingSource, Platform, ScoreResult } from './common';

/** Foto referenciada pelo anúncio (a análise de pixels vive em photo.ts). */
export interface ListingPhotoRef {
  position: number;
  url?: string;
  caption?: string;
  roomHint?: string;
}

export interface ReviewHighlights {
  positive: string[];
  negative: string[];
}

/**
 * Formato normalizado de um anúncio, comum a Airbnb e Booking.
 *
 * Todo provider — manual, mock ou integração futura — devolve exatamente esta
 * forma, de modo que as análises não sabem de onde o dado veio.
 */
export interface ListingData {
  platform: Platform;
  source: ListingSource;
  /** true obriga a UI a rotular como dado simulado. */
  isMock: boolean;
  externalUrl?: string;

  title?: string;
  description?: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  beds?: number;
  maxGuests?: number;

  amenities: string[];
  houseRules: string[];
  cancellationPolicy?: string;
  checkIn?: string;
  checkOut?: string;
  minimumStay?: number;

  rating?: number;
  reviewCount?: number;
  reviewHighlights?: ReviewHighlights;

  photos: ListingPhotoRef[];

  // Específicos de Booking.
  roomTypes?: string[];
  breakfastIncluded?: boolean;

  // Específicos de Airbnb.
  isSuperhost?: boolean;
  instantBook?: boolean;

  capturedAt: string;
}

export interface ListingAnalysisResult {
  platform: Platform;
  score: ScoreResult;
  strengths: string[];
  weaknesses: string[];
  /** Campos relevantes que o anúncio não preencheu. */
  missingInfo: string[];
  problems: Finding[];
  /** Como o anúncio se posiciona (ex.: "econômico", "premium familiar"). */
  positioning?: string;
  differentiators: string[];
  provider?: string;
  model?: string;
}
