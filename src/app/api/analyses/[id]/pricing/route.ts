import { requireUserId } from '@/server/auth';
import { env } from '@/server/config/env';
import { AppError } from '@/server/core/shared/errors';
import { route } from '@/server/http/handler';
import { analysisService } from '@/server/services/AnalysisService';

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return route(async () => {
    const userId = await requireUserId();
    const { id } = await context.params;

    const form = await request.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      throw new AppError('Envie o arquivo CSV no campo "file".', {
        code: 'VALIDATION_ERROR',
      });
    }

    const maxBytes = env.MAX_CSV_SIZE_MB * 1_048_576;

    if (file.size > maxBytes) {
      throw new AppError(
        `O CSV tem ${(file.size / 1_048_576).toFixed(1)} MB e excede o limite ` +
          `de ${env.MAX_CSV_SIZE_MB} MB.`,
        { code: 'FILE_TOO_LARGE' },
      );
    }

    const content = await file.text();

    return analysisService.attachPricingCsv(id, userId, content, file.name);
  }, 201);
}
