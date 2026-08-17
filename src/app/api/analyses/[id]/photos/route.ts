import { requireUserId } from '@/server/auth';
import { AppError } from '@/server/core/shared/errors';
import { route } from '@/server/http/handler';
import { analysisService, type PhotoUpload } from '@/server/services/AnalysisService';

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return route(async () => {
    const userId = await requireUserId();
    const { id } = await context.params;

    const form = await request.formData();
    const files = form.getAll('files').filter((f): f is File => f instanceof File);

    if (files.length === 0) {
      throw new AppError('Envie ao menos uma imagem no campo "files".', {
        code: 'VALIDATION_ERROR',
      });
    }

    // A ordem do formulário é a ordem das fotos no anúncio, e é ela que
    // determina qual é a capa.
    const uploads: PhotoUpload[] = await Promise.all(
      files.map(async (file) => ({
        fileName: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })),
    );

    return analysisService.attachPhotos(id, userId, uploads);
  }, 201);
}
