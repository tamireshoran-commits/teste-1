import type { Finding, ListingData, Platform } from '@/server/core/types';
import { matchAmenities, type AmenityCoverage } from './amenities';

/**
 * Verificações determinísticas do anúncio.
 *
 * Rodam sem IA: comprimento de título, cobertura de comodidades, campos
 * ausentes, rigidez de política, volume de avaliações. Custo zero e resultado
 * reproduzível — a IA entra depois só para o julgamento qualitativo que estas
 * regras não alcançam.
 */

/** Faixas de título que funcionam nas duas plataformas. */
const TITLE = { min: 25, ideal: 40, max: 60, hardMax: 90 } as const;

/** Descrição curta demais não converte; longa demais ninguém lê. */
const DESCRIPTION = { min: 200, ideal: 600, hardMax: 5000 } as const;

/** Abaixo disto, a nota ainda não é estatisticamente confiável. */
const LOW_REVIEW_COUNT = 10;

/** Políticas que reduzem conversão de forma reconhecida no setor. */
const STRICT_POLICIES = ['rigorosa', 'strict', 'não reembolsável', 'nao reembolsavel', 'non-refundable'];

export interface ListingChecks {
  findings: Finding[];
  missingInfo: string[];
  strengths: string[];
  amenities: AmenityCoverage;
  /** Nota normalizada para 0..100, independente da escala da plataforma. */
  normalizedRating: number | null;
}

export function runListingChecks(listing: ListingData): ListingChecks {
  const findings: Finding[] = [];
  const missingInfo: string[] = [];
  const strengths: string[] = [];

  const amenities = matchAmenities(listing.amenities);

  checkTitle(listing, findings, missingInfo, strengths);
  checkDescription(listing, findings, missingInfo, strengths);
  checkAmenities(amenities, findings, strengths);
  checkPhotos(listing, findings, missingInfo, strengths);
  checkReputation(listing, findings, missingInfo, strengths);
  checkPolicies(listing, findings, missingInfo);
  checkBasicInfo(listing, missingInfo);
  checkPlatformSpecific(listing, findings, missingInfo, strengths);

  return {
    findings,
    missingInfo,
    strengths,
    amenities,
    normalizedRating: normalizeRating(listing.platform, listing.rating),
  };
}

/** Airbnb usa escala 0-5 e Booking 0-10; o score interno trabalha em 0-100. */
export function normalizeRating(
  platform: Platform,
  rating: number | undefined,
): number | null {
  if (rating === undefined) return null;

  const max = platform === 'AIRBNB' ? 5 : 10;
  return Math.min(100, Math.max(0, (rating / max) * 100));
}

function checkTitle(
  listing: ListingData,
  findings: Finding[],
  missingInfo: string[],
  strengths: string[],
): void {
  const title = listing.title?.trim();

  if (!title) {
    missingInfo.push('Título do anúncio');
    findings.push({
      code: 'TITLE_MISSING',
      title: 'Anúncio sem título',
      detail: 'O título é o primeiro elemento que o hóspede lê na busca.',
      severity: 'HIGH',
    });
    return;
  }

  if (title.length < TITLE.min) {
    findings.push({
      code: 'TITLE_TOO_SHORT',
      title: 'Título curto demais',
      detail:
        `O título tem ${title.length} caracteres. Abaixo de ${TITLE.min} ` +
        'sobra espaço não aproveitado para diferenciais e localização.',
      severity: 'MEDIUM',
      evidence: { length: title.length, recommendedMin: TITLE.min },
    });
  } else if (title.length > TITLE.hardMax) {
    findings.push({
      code: 'TITLE_TOO_LONG',
      title: 'Título longo demais',
      detail:
        `O título tem ${title.length} caracteres e provavelmente é cortado ` +
        'na listagem de resultados.',
      severity: 'MEDIUM',
      evidence: { length: title.length, recommendedMax: TITLE.max },
    });
  } else if (title.length >= TITLE.ideal && title.length <= TITLE.max) {
    strengths.push('Título com tamanho adequado para a listagem de resultados');
  }

  if (/^[A-ZÀ-Ú\s\d!]+$/.test(title) && title.length > 15) {
    findings.push({
      code: 'TITLE_ALL_CAPS',
      title: 'Título todo em maiúsculas',
      detail:
        'Texto em caixa alta é lido como agressivo e algumas plataformas ' +
        'penalizam a prática.',
      severity: 'MEDIUM',
      evidence: { title },
    });
  }
}

function checkDescription(
  listing: ListingData,
  findings: Finding[],
  missingInfo: string[],
  strengths: string[],
): void {
  const description = listing.description?.trim();

  if (!description) {
    missingInfo.push('Descrição do anúncio');
    findings.push({
      code: 'DESCRIPTION_MISSING',
      title: 'Anúncio sem descrição',
      detail:
        'Sem descrição, o hóspede não tem como avaliar se o imóvel atende à ' +
        'necessidade dele.',
      severity: 'HIGH',
    });
    return;
  }

  if (description.length < DESCRIPTION.min) {
    findings.push({
      code: 'DESCRIPTION_TOO_SHORT',
      title: 'Descrição curta demais',
      detail:
        `A descrição tem ${description.length} caracteres. Anúncios ` +
        `competitivos costumam passar de ${DESCRIPTION.min}, cobrindo ` +
        'ambientes, localização e regras.',
      severity: 'HIGH',
      evidence: { length: description.length, recommendedMin: DESCRIPTION.min },
    });
  } else if (description.length >= DESCRIPTION.ideal) {
    strengths.push('Descrição detalhada');
  }
}

function checkAmenities(
  amenities: AmenityCoverage,
  findings: Finding[],
  strengths: string[],
): void {
  const missingEssential = amenities.missing.filter((a) => a.tier === 'ESSENTIAL');
  const missingExpected = amenities.missing.filter((a) => a.tier === 'EXPECTED');
  const presentDifferentiators = amenities.present.filter(
    (a) => a.tier === 'DIFFERENTIATOR',
  );

  if (missingEssential.length > 0) {
    findings.push({
      code: 'MISSING_ESSENTIAL_AMENITIES',
      title: 'Comodidades essenciais não declaradas',
      detail:
        `Não constam no anúncio: ${missingEssential.map((a) => a.label).join(', ')}. ` +
        'Se o imóvel tem esses itens, declará-los aumenta a chance de aparecer ' +
        'em buscas com filtro.',
      severity: 'HIGH',
      evidence: { missing: missingEssential.map((a) => a.key) },
    });
  }

  if (missingExpected.length >= 4) {
    findings.push({
      code: 'MISSING_EXPECTED_AMENITIES',
      title: 'Poucas comodidades declaradas',
      detail:
        `${missingExpected.length} comodidades comuns não constam: ` +
        `${missingExpected.map((a) => a.label).join(', ')}.`,
      severity: 'MEDIUM',
      evidence: { missing: missingExpected.map((a) => a.key) },
    });
  }

  if (presentDifferentiators.length >= 2) {
    strengths.push(
      `Diferenciais declarados: ${presentDifferentiators.map((a) => a.label).join(', ')}`,
    );
  }
}

function checkPhotos(
  listing: ListingData,
  findings: Finding[],
  missingInfo: string[],
  strengths: string[],
): void {
  const count = listing.photos.length;

  if (count === 0) {
    missingInfo.push('Fotos do anúncio');
    findings.push({
      code: 'NO_PHOTOS',
      title: 'Anúncio sem fotos',
      detail: 'Anúncios sem foto praticamente não recebem reservas.',
      severity: 'HIGH',
    });
    return;
  }

  // As plataformas recomendam pelo menos 10 fotos; abaixo disso o anúncio
  // costuma perder posição nos filtros de qualidade.
  if (count < 10) {
    findings.push({
      code: 'FEW_PHOTOS',
      title: 'Poucas fotos',
      detail:
        `O anúncio tem ${count} foto(s). As plataformas recomendam ao menos ` +
        '10 para cobrir todos os ambientes.',
      severity: count < 5 ? 'HIGH' : 'MEDIUM',
      evidence: { photoCount: count, recommendedMin: 10 },
    });
  } else if (count >= 15) {
    strengths.push(`Boa quantidade de fotos (${count})`);
  }
}

function checkReputation(
  listing: ListingData,
  findings: Finding[],
  missingInfo: string[],
  strengths: string[],
): void {
  const normalized = normalizeRating(listing.platform, listing.rating);

  if (normalized === null) {
    missingInfo.push('Nota de avaliação');
  }

  // Os temas recorrentes dos comentários são independentes de a quantidade de
  // avaliações ter sido preenchida, então são avaliados antes de qualquer
  // saída antecipada — um `return` aqui já engoliu essa checagem uma vez.
  const negatives = listing.reviewHighlights?.negative ?? [];
  if (negatives.length >= 2) {
    findings.push({
      code: 'RECURRING_NEGATIVES',
      title: 'Pontos negativos recorrentes nos comentários',
      detail: `Temas citados: ${negatives.join('; ')}.`,
      severity: 'MEDIUM',
      evidence: { negatives },
    });
  }

  if (listing.reviewCount === undefined) {
    missingInfo.push('Quantidade de avaliações');
    return;
  }

  if (listing.reviewCount === 0) {
    findings.push({
      code: 'NO_REVIEWS',
      title: 'Anúncio sem avaliações',
      detail:
        'Sem histórico de avaliações, o hóspede assume mais risco ao reservar.',
      severity: 'HIGH',
      evidence: { reviewCount: 0 },
    });
  } else if (listing.reviewCount < LOW_REVIEW_COUNT) {
    findings.push({
      code: 'FEW_REVIEWS',
      title: 'Poucas avaliações',
      detail:
        `O anúncio tem ${listing.reviewCount} avaliação(ões). Abaixo de ` +
        `${LOW_REVIEW_COUNT}, a nota ainda oscila muito com cada nova estadia.`,
      severity: 'MEDIUM',
      evidence: { reviewCount: listing.reviewCount },
    });
  }

  if (normalized !== null && normalized >= 90 && (listing.reviewCount ?? 0) >= 20) {
    strengths.push(
      `Reputação sólida: ${listing.rating} com ${listing.reviewCount} avaliações`,
    );
  }

  if (normalized !== null && normalized < 80 && (listing.reviewCount ?? 0) >= LOW_REVIEW_COUNT) {
    findings.push({
      code: 'LOW_RATING',
      title: 'Nota abaixo da média do mercado',
      detail:
        `A nota ${listing.rating} está abaixo do patamar que hóspedes usam ` +
        'como referência ao filtrar resultados.',
      severity: 'HIGH',
      evidence: { rating: listing.rating, normalized },
    });
  }
}

function checkPolicies(
  listing: ListingData,
  findings: Finding[],
  missingInfo: string[],
): void {
  const policy = listing.cancellationPolicy?.trim();

  if (!policy) {
    missingInfo.push('Política de cancelamento');
  } else if (
    STRICT_POLICIES.some((p) => policy.toLowerCase().includes(p))
  ) {
    findings.push({
      code: 'STRICT_CANCELLATION',
      title: 'Política de cancelamento restritiva',
      detail:
        `A política "${policy}" reduz o risco de cancelamento, mas também ` +
        'costuma reduzir a conversão frente a anúncios mais flexíveis.',
      severity: 'MEDIUM',
      evidence: { policy },
    });
  }

  if (!listing.checkIn) missingInfo.push('Horário de check-in');
  if (!listing.checkOut) missingInfo.push('Horário de check-out');

  if (listing.houseRules.length === 0) {
    missingInfo.push('Regras da casa');
  } else if (listing.houseRules.length >= 8) {
    findings.push({
      code: 'MANY_HOUSE_RULES',
      title: 'Muitas regras da casa',
      detail:
        `São ${listing.houseRules.length} regras. Listas longas de proibições ` +
        'passam impressão de rigidez.',
      severity: 'LOW',
      evidence: { ruleCount: listing.houseRules.length },
    });
  }

  if (listing.minimumStay !== undefined && listing.minimumStay >= 5) {
    findings.push({
      code: 'HIGH_MINIMUM_STAY',
      title: 'Estadia mínima alta',
      detail:
        `A estadia mínima de ${listing.minimumStay} noites exclui o anúncio ` +
        'das buscas por estadias curtas.',
      severity: 'MEDIUM',
      evidence: { minimumStay: listing.minimumStay },
    });
  }
}

function checkBasicInfo(listing: ListingData, missingInfo: string[]): void {
  if (listing.propertyType === undefined) missingInfo.push('Tipo do imóvel');
  if (listing.bedrooms === undefined) missingInfo.push('Número de quartos');
  if (listing.bathrooms === undefined) missingInfo.push('Número de banheiros');
  if (listing.beds === undefined) missingInfo.push('Número de camas');
  if (listing.maxGuests === undefined) missingInfo.push('Capacidade de hóspedes');
}

function checkPlatformSpecific(
  listing: ListingData,
  findings: Finding[],
  missingInfo: string[],
  strengths: string[],
): void {
  if (listing.platform === 'AIRBNB') {
    if (listing.isSuperhost === true) strengths.push('Selo de Superhost');
    if (listing.instantBook === true) strengths.push('Reserva instantânea ativa');

    if (listing.instantBook === false) {
      findings.push({
        code: 'NO_INSTANT_BOOK',
        title: 'Reserva instantânea desativada',
        detail:
          'Sem reserva instantânea o anúncio perde hóspedes que filtram por ' +
          'ela e a decisão passa a depender do seu tempo de resposta.',
        severity: 'MEDIUM',
      });
    }
    return;
  }

  // Booking.com
  if (listing.breakfastIncluded === undefined) {
    missingInfo.push('Informação sobre café da manhã');
  } else if (listing.breakfastIncluded) {
    strengths.push('Café da manhã incluído');
  }

  if (!listing.roomTypes || listing.roomTypes.length === 0) {
    missingInfo.push('Tipos de quarto');
    findings.push({
      code: 'NO_ROOM_TYPES',
      title: 'Tipos de quarto não informados',
      detail:
        'O Booking.com organiza a oferta por tipo de quarto; sem isso o ' +
        'anúncio fica incompleto na busca.',
      severity: 'MEDIUM',
    });
  }
}
