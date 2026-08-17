import { z } from 'zod';
import { requireUserId } from '@/server/auth';
import { parseBody, route } from '@/server/http/handler';
import { analysisService } from '@/server/services/AnalysisService';

const createSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do imóvel').max(160),
  city: z.string().trim().max(120).optional(),
  propertyType: z.string().trim().max(80).optional(),
  bedrooms: z.coerce.number().int().min(0).max(50).optional(),
  airbnbUrl: z.string().trim().url().optional().or(z.literal('')),
  bookingUrl: z.string().trim().url().optional().or(z.literal('')),
});

export function GET() {
  return route(async () => {
    const userId = await requireUserId();
    return { analyses: await analysisService.listForUser(userId) };
  });
}

export function POST(request: Request) {
  return route(async () => {
    const userId = await requireUserId();
    const body = await parseBody(request, createSchema);

    const analysis = await analysisService.create(userId, {
      name: body.name,
      ...(body.city ? { city: body.city } : {}),
      ...(body.propertyType ? { propertyType: body.propertyType } : {}),
      ...(body.bedrooms !== undefined ? { bedrooms: body.bedrooms } : {}),
      ...(body.airbnbUrl ? { airbnbUrl: body.airbnbUrl } : {}),
      ...(body.bookingUrl ? { bookingUrl: body.bookingUrl } : {}),
    });

    return { id: analysis.id };
  }, 201);
}
