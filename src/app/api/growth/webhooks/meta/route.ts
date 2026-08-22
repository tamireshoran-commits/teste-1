import { NextResponse } from 'next/server';
import { env } from '@/server/config/env';
import { logger } from '@/server/core/shared/logger';
import { metaWebhookService } from '@/server/growth/webhooks/MetaWebhookService';
import { verifyChallenge } from '@/server/growth/webhooks/metaSignature';

const log = logger.child('webhook-route');

/**
 * Webhook da Meta.
 *
 * Rota pública por natureza — a Meta não se autentica com a nossa sessão. A
 * defesa é a assinatura HMAC do corpo, verificada em
 * `MetaWebhookService.receive`.
 *
 * Responde sempre rápido: a Meta reenvia o evento se não receber 200 em
 * poucos segundos, e reenvio é entrega duplicada.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const verifyToken = env.META_VERIFY_TOKEN;

  if (verifyToken === undefined || verifyToken.trim() === '') {
    log.warn('META_VERIFY_TOKEN não configurado');
    return new NextResponse('verify token não configurado', { status: 500 });
  }

  const challenge = verifyChallenge({
    mode: params.get('hub.mode'),
    token: params.get('hub.verify_token'),
    challenge: params.get('hub.challenge'),
    verifyToken,
  });

  if (challenge === null) {
    return new NextResponse('verificação recusada', { status: 403 });
  }

  // A Meta espera o desafio de volta como texto puro.
  return new NextResponse(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  const result = await metaWebhookService.receive({
    rawBody,
    signatureHeader: request.headers.get('x-hub-signature-256'),
  });

  if (result.unauthorized === true) {
    return new NextResponse('assinatura inválida', { status: 401 });
  }

  return NextResponse.json({
    accepted: result.accepted,
    ignored: result.ignored,
  });
}
