import { NextResponse } from 'next/server';
import { getStorageProvider } from '@/server/core/providers/registry';
import { logger } from '@/server/core/shared/logger';
import { prisma } from '@/server/db/prisma';

const log = logger.child('growth-media-route');

const CONTENT_TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
};

/**
 * Serve a mídia gerada.
 *
 * Precisa ser público: na hora de publicar, a Meta **baixa o arquivo do nosso
 * servidor** por URL — não há como enviar bytes na chamada de publicação.
 *
 * A proteção não é autenticação, e sim escopo: só serve chave que existe em
 * `growth_media_assets`. Sem essa checagem, a rota viraria um leitor genérico
 * do storage, com as fotos das análises do outro módulo inclusas.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string }> },
) {
  const { key } = await context.params;
  const storageKey = decodeURIComponent(key);

  const asset = await prisma.mediaAsset.findFirst({
    where: { storageKey },
    select: { id: true },
  });

  if (!asset) {
    return NextResponse.json({ error: 'Arquivo não encontrado' }, { status: 404 });
  }

  try {
    const data = await getStorageProvider().get(storageKey);
    const extension = storageKey.split('.').pop()?.toLowerCase() ?? '';

    return new NextResponse(Buffer.from(data), {
      status: 200,
      headers: {
        'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    log.warn('falha ao servir mídia', { storageKey, error });
    return NextResponse.json({ error: 'Arquivo não encontrado' }, { status: 404 });
  }
}
