import { z } from 'zod';
import { requireUserId } from '@/server/auth';
import { parseBody, route } from '@/server/http/handler';
import { analysisService } from '@/server/services/AnalysisService';

const bodySchema = z.object({
  platform: z.enum(['AIRBNB', 'BOOKING']),
  /** Usa a fixture simulada em vez do formulário — sempre rotulada na UI. */
  useMock: z.boolean().optional(),
  url: z.string().trim().url().optional().or(z.literal('')),
  /** Campos do anúncio; a validação de verdade acontece em listingSchema. */
  data: z.record(z.string(), z.unknown()).optional(),
});

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return route(async () => {
    const userId = await requireUserId();
    const { id } = await context.params;
    const body = await parseBody(request, bodySchema);

    const listing = await analysisService.attachListing(
      id,
      userId,
      body.platform,
      {
        ...(body.url ? { url: body.url } : {}),
        ...(body.data ? { manualData: body.data } : {}),
        ...(body.useMock !== undefined ? { useMock: body.useMock } : {}),
      },
    );

    return {
      platform: listing.platform,
      source: listing.source,
      isMock: listing.isMock,
      title: listing.title ?? null,
      photoCount: listing.photos.length,
      amenityCount: listing.amenities.length,
    };
  }, 201);
}
