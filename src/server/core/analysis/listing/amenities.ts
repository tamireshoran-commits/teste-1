/**
 * Catálogo de comodidades esperadas em aluguel por temporada.
 *
 * O texto de comodidade varia por plataforma e idioma ("Wi-Fi gratuito",
 * "Internet sem fio", "WiFi"), então o casamento é feito por palavras-chave
 * normalizadas, não por igualdade de string.
 *
 * As listas refletem o que hóspedes procuram nos filtros das plataformas. Não
 * são regra universal: um chalé de montanha não precisa de ar-condicionado.
 * Por isso a ausência vira **observação**, nunca erro — e a severidade fica
 * em MEDIUM ou LOW.
 */

export type AmenityTier = 'ESSENTIAL' | 'EXPECTED' | 'DIFFERENTIATOR';

export interface AmenityDefinition {
  key: string;
  label: string;
  tier: AmenityTier;
  keywords: string[];
}

export const AMENITY_CATALOG: readonly AmenityDefinition[] = [
  // Essenciais: a ausência costuma eliminar o anúncio de buscas filtradas.
  { key: 'wifi', label: 'Wi-Fi', tier: 'ESSENTIAL', keywords: ['wifi', 'wi fi', 'internet', 'banda larga'] },
  { key: 'kitchen', label: 'Cozinha', tier: 'ESSENTIAL', keywords: ['cozinha', 'kitchen', 'kitchenette'] },
  { key: 'bedding', label: 'Roupa de cama', tier: 'ESSENTIAL', keywords: ['roupa de cama', 'lencol', 'linens', 'bedding'] },
  { key: 'towels', label: 'Toalhas', tier: 'ESSENTIAL', keywords: ['toalha', 'towel'] },

  // Esperadas: a ausência não elimina, mas pesa na comparação.
  { key: 'ac', label: 'Ar-condicionado', tier: 'EXPECTED', keywords: ['ar condicionado', 'ar-condicionado', 'air conditioning', 'climatizacao', 'split'] },
  { key: 'heating', label: 'Aquecimento', tier: 'EXPECTED', keywords: ['aquecimento', 'aquecedor', 'heating', 'calefacao'] },
  { key: 'washer', label: 'Máquina de lavar', tier: 'EXPECTED', keywords: ['maquina de lavar', 'lavadora', 'washer', 'washing machine'] },
  { key: 'tv', label: 'TV', tier: 'EXPECTED', keywords: ['tv', 'televisao', 'television', 'smart tv'] },
  { key: 'parking', label: 'Estacionamento', tier: 'EXPECTED', keywords: ['estacionamento', 'garagem', 'vaga', 'parking'] },
  { key: 'workspace', label: 'Espaço de trabalho', tier: 'EXPECTED', keywords: ['espaco de trabalho', 'escritorio', 'workspace', 'mesa de trabalho', 'home office'] },
  { key: 'hairdryer', label: 'Secador de cabelo', tier: 'EXPECTED', keywords: ['secador', 'hair dryer', 'hairdryer'] },
  { key: 'essentials', label: 'Itens de higiene', tier: 'EXPECTED', keywords: ['itens basicos', 'sabonete', 'shampoo', 'papel higienico', 'essentials', 'toiletries'] },

  // Diferenciais: presença é vantagem competitiva, ausência não é problema.
  { key: 'pool', label: 'Piscina', tier: 'DIFFERENTIATOR', keywords: ['piscina', 'pool'] },
  { key: 'bbq', label: 'Churrasqueira', tier: 'DIFFERENTIATOR', keywords: ['churrasqueira', 'churrasco', 'bbq', 'barbecue', 'grill'] },
  { key: 'view', label: 'Vista', tier: 'DIFFERENTIATOR', keywords: ['vista', 'view', 'vista para o mar', 'ocean view'] },
  { key: 'balcony', label: 'Varanda', tier: 'DIFFERENTIATOR', keywords: ['varanda', 'sacada', 'balcony', 'terraco', 'terrace'] },
  { key: 'pets', label: 'Aceita animais', tier: 'DIFFERENTIATOR', keywords: ['animais', 'pet', 'pets permitidos', 'pet friendly'] },
  { key: 'gym', label: 'Academia', tier: 'DIFFERENTIATOR', keywords: ['academia', 'gym', 'fitness'] },
  { key: 'elevator', label: 'Elevador', tier: 'DIFFERENTIATOR', keywords: ['elevador', 'elevator', 'lift'] },
  { key: 'crib', label: 'Berço', tier: 'DIFFERENTIATOR', keywords: ['berco', 'crib', 'cadeirao', 'high chair'] },
] as const;

/** Normaliza para comparação: minúsculas, sem acento, sem pontuação. */
export function normalizeAmenity(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface AmenityCoverage {
  present: AmenityDefinition[];
  missing: AmenityDefinition[];
  /** Comodidades informadas que não estão no catálogo. */
  extra: string[];
}

/**
 * Cruza as comodidades declaradas com o catálogo.
 *
 * Uma comodidade conta como presente quando qualquer palavra-chave dela
 * aparece em qualquer item da lista informada — "Wi-Fi gratuito na área
 * comum" satisfaz `wifi`.
 */
export function matchAmenities(declared: readonly string[]): AmenityCoverage {
  const normalized = declared.map(normalizeAmenity).filter((t) => t !== '');

  const present: AmenityDefinition[] = [];
  const missing: AmenityDefinition[] = [];
  const matchedInputs = new Set<string>();

  for (const definition of AMENITY_CATALOG) {
    const hit = normalized.find((item) =>
      definition.keywords.some((keyword) => item.includes(normalizeAmenity(keyword))),
    );

    if (hit !== undefined) {
      present.push(definition);
      matchedInputs.add(hit);
    } else {
      missing.push(definition);
    }
  }

  const extra = declared.filter(
    (item) => !matchedInputs.has(normalizeAmenity(item)),
  );

  return { present, missing, extra };
}

export function countByTier(
  items: readonly AmenityDefinition[],
  tier: AmenityTier,
): number {
  return items.filter((a) => a.tier === tier).length;
}

export function totalInTier(tier: AmenityTier): number {
  return AMENITY_CATALOG.filter((a) => a.tier === tier).length;
}
