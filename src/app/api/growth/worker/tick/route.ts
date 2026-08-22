import { NextResponse } from 'next/server';
import { env } from '@/server/config/env';
import { auth } from '@/server/auth';
import { logger } from '@/server/core/shared/logger';
import { runGrowthWorkerTick } from '@/server/growth/jobs/registry';

const log = logger.child('worker-route');

/**
 * Um ciclo do worker, disparado por cron externo.
 *
 * É o que permite rodar em hospedagem serverless, onde não existe processo
 * longo: um cron chama este endpoint a cada minuto e cada chamada processa um
 * lote. Em um servidor dedicado, o mesmo `runGrowthWorkerTick` roda em laço.
 *
 * Autorização: `CRON_SECRET` para o cron, sessão autenticada para acionar
 * manualmente do painel. Sem nenhum dos dois, qualquer um poderia esvaziar a
 * fila da sua conta a partir da internet.
 */
export async function POST(request: Request) {
  const secret = env.CRON_SECRET;
  const provided =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null;

  const authorizedByCron =
    secret !== undefined && secret !== '' && provided === secret;

  if (!authorizedByCron) {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }
  }

  const result = await runGrowthWorkerTick();

  if (result.claimed > 0) {
    log.info('tick do worker', result);
  }

  return NextResponse.json(result);
}
