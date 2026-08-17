import type { PhotoAnalysisResult, PhotoSetInsights } from '@/server/core/types';

/**
 * Achados que só existem olhando o conjunto, não uma foto isolada.
 *
 * Nada aqui chama IA: são comparações sobre as notas que a etapa anterior já
 * produziu. Custo zero e resultado reproduzível.
 */

/** Ambientes que um anúncio de temporada normalmente precisa mostrar. */
export const EXPECTED_ROOMS = [
  'sala',
  'quarto',
  'cozinha',
  'banheiro',
] as const;

/** Abaixo disso, o ambiente está coberto mas com foto ruim. */
const WEAK_COVERAGE_SCORE = 60;

/** Fotos do mesmo ambiente com notas muito próximas tendem a ser redundantes. */
const REDUNDANCY_SCORE_DELTA = 6;

export function buildPhotoSetInsights(
  photos: readonly PhotoAnalysisResult[],
): PhotoSetInsights {
  if (photos.length === 0) {
    return {
      bestPhotoId: null,
      worstPhotoId: null,
      suggestedCoverPhotoId: null,
      redundantPhotoIds: [],
      coveredRooms: [],
      missingRooms: [...EXPECTED_ROOMS],
      weaklyCoveredRooms: [],
    };
  }

  const sorted = [...photos].sort((a, b) => b.score - a.score);
  const best = sorted[0]!;
  const worst = sorted[sorted.length - 1]!;

  const coveredRooms = [...new Set(photos.map((p) => p.roomType))];

  const missingRooms = EXPECTED_ROOMS.filter(
    (room) => !coveredRooms.includes(room),
  );

  const weaklyCoveredRooms = coveredRooms.filter((room) => {
    const roomPhotos = photos.filter((p) => p.roomType === room);
    return roomPhotos.every((p) => p.score < WEAK_COVERAGE_SCORE);
  });

  return {
    bestPhotoId: best.photoId,
    worstPhotoId: photos.length > 1 ? worst.photoId : null,
    suggestedCoverPhotoId: suggestCover(photos, best),
    redundantPhotoIds: findRedundant(photos),
    coveredRooms,
    missingRooms,
    weaklyCoveredRooms,
  };
}

/**
 * Sugere trocar a capa quando existe foto claramente melhor.
 *
 * A capa é a foto na posição 0 do anúncio. Só sugerimos a troca se a melhor
 * foto superar a atual por uma margem relevante — trocar por 2 pontos de
 * diferença seria ruído, não recomendação.
 */
function suggestCover(
  photos: readonly PhotoAnalysisResult[],
  best: PhotoAnalysisResult,
): string | null {
  // A ordem de `photos` acompanha a posição no anúncio.
  const current = photos[0];
  if (!current || current.photoId === best.photoId) return null;

  const MEANINGFUL_MARGIN = 10;
  return best.score - current.score >= MEANINGFUL_MARGIN ? best.photoId : null;
}

/**
 * Marca como redundante a segunda e as seguintes fotos do mesmo ambiente com
 * nota muito parecida. Mantém sempre a de maior nota do grupo.
 */
function findRedundant(photos: readonly PhotoAnalysisResult[]): string[] {
  const byRoom = new Map<string, PhotoAnalysisResult[]>();

  for (const photo of photos) {
    const bucket = byRoom.get(photo.roomType);
    if (bucket) bucket.push(photo);
    else byRoom.set(photo.roomType, [photo]);
  }

  const redundant: string[] = [];

  for (const group of byRoom.values()) {
    if (group.length < 3) continue;

    const sorted = [...group].sort((a, b) => b.score - a.score);
    const keeper = sorted[0]!;

    for (const photo of sorted.slice(1)) {
      if (Math.abs(keeper.score - photo.score) <= REDUNDANCY_SCORE_DELTA) {
        redundant.push(photo.photoId);
      }
    }
  }

  return redundant;
}
