import { z } from 'zod';
import { requireUserId } from '@/server/auth';
import { parseBody, route } from '@/server/http/handler';
import { prisma } from '@/server/db/prisma';
import { workspaceService } from '@/server/growth/services/WorkspaceService';

const productSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().min(5).max(2000),
  priceCents: z.number().int().min(0).max(100_000_000).optional(),
  currency: z.string().trim().length(3).optional(),
  checkoutUrl: z.string().trim().url().optional().or(z.literal('')),
  schedulingUrl: z.string().trim().url().optional().or(z.literal('')),
  benefits: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
});

export function GET() {
  return route(async () => {
    const userId = await requireUserId();
    const workspace = await workspaceService.ensureForUser(userId);

    return {
      products: await prisma.product.findMany({
        where: { workspaceId: workspace.id },
        orderBy: { createdAt: 'asc' },
      }),
    };
  });
}

export function POST(request: Request) {
  return route(async () => {
    const userId = await requireUserId();
    const workspace = await workspaceService.ensureForUser(userId);
    const body = await parseBody(request, productSchema);

    return workspaceService.createProduct(workspace.id, userId, body);
  }, 201);
}
