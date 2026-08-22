import { z } from 'zod';
import { requireUserId } from '@/server/auth';
import { parseBody, route } from '@/server/http/handler';
import { workspaceService } from '@/server/growth/services/WorkspaceService';

const brandSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
  toneOfVoice: z.string().trim().max(500).optional(),
  valueProposition: z.string().trim().max(500).optional(),
  doNotSay: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  guardrails: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
  defaultCta: z.string().trim().max(200).optional(),
  language: z.string().trim().max(10).optional(),
});

export function PUT(request: Request) {
  return route(async () => {
    const userId = await requireUserId();
    const workspace = await workspaceService.ensureForUser(userId);
    const body = await parseBody(request, brandSchema);

    return workspaceService.upsertBrand(workspace.id, userId, body);
  });
}
