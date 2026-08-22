import { env } from '@/server/config/env';
import { logger } from '@/server/core/shared/logger';
import { prisma } from '@/server/db/prisma';
import { growthQueue } from '../jobs/queue';
import { normalizeMetaWebhook, type NormalizedEvent } from './metaEvents';
import { verifyMetaSignature } from './metaSignature';

const log = logger.child('meta-webhook');

/**
 * Recepção de webhooks da Meta.
 *
 * O endpoint faz o mínimo possível e responde rápido: valida a assinatura,
 * grava o evento e enfileira o processamento. A Meta reenvia o evento se não
 * receber 200 em poucos segundos — processar de forma síncrona (qualificar
 * lead, chamar o modelo, responder) garantiria timeout e entrega duplicada.
 *
 * A idempotência tem duas camadas: `WebhookEvent.externalId` é único e o job
 * carrega `dedupeKey`. Uma protege contra reentrega da Meta; a outra, contra
 * dois workers processando o mesmo evento.
 */
export class MetaWebhookService {
  async receive(input: {
    rawBody: string;
    signatureHeader: string | null;
  }): Promise<{ accepted: number; ignored: number; unauthorized?: true }> {
    const appSecret = env.META_APP_SECRET?.trim();

    if (appSecret === undefined || appSecret === '') {
      // Sem segredo configurado não há como distinguir a Meta de um curioso.
      // Recusar é a única opção segura — inclusive em desenvolvimento.
      log.error('META_APP_SECRET não configurado; webhook recusado');
      return { accepted: 0, ignored: 0, unauthorized: true };
    }

    const valid = verifyMetaSignature({
      rawBody: input.rawBody,
      signatureHeader: input.signatureHeader,
      appSecret,
    });

    if (!valid) {
      log.warn('assinatura de webhook inválida');
      return { accepted: 0, ignored: 0, unauthorized: true };
    }

    let payload: unknown;

    try {
      payload = JSON.parse(input.rawBody);
    } catch {
      log.warn('corpo do webhook não é JSON');
      return { accepted: 0, ignored: 0 };
    }

    const events = normalizeMetaWebhook(payload);

    let accepted = 0;
    let ignored = 0;

    for (const event of events) {
      const stored = await this.store(event, payload);

      if (stored) accepted++;
      else ignored++;
    }

    return { accepted, ignored };
  }

  private async store(
    event: NormalizedEvent,
    raw: unknown,
  ): Promise<boolean> {
    const existing = await prisma.webhookEvent.findUnique({
      where: { externalId: event.externalId },
      select: { id: true },
    });

    if (existing) return false;

    // Resolve o workspace pela conta que recebeu a interação. Evento de conta
    // não cadastrada é registrado como IGNORED em vez de descartado: se a
    // configuração estiver errada, o registro é o que mostra isso.
    const account = await prisma.socialAccount.findFirst({
      where: {
        platform: event.platform,
        OR: [
          { externalId: event.recipientExternalId },
          { pageId: event.recipientExternalId },
        ],
      },
      select: { id: true, workspaceId: true },
    });

    const stored = await prisma.webhookEvent.create({
      data: {
        platform: event.platform,
        externalId: event.externalId,
        topic: event.topic,
        signatureValid: true,
        status: account === null ? 'IGNORED' : 'RECEIVED',
        errorMessage:
          account === null
            ? `Nenhuma conta cadastrada para ${event.recipientExternalId}.`
            : null,
        payload: {
          normalized: {
            ...event,
            occurredAt: event.occurredAt.toISOString(),
          },
          socialAccountId: account?.id ?? null,
          workspaceId: account?.workspaceId ?? null,
          raw,
        } as object,
      },
    });

    if (account === null) {
      log.warn('evento sem conta correspondente', {
        recipient: event.recipientExternalId,
      });

      return false;
    }

    await growthQueue.enqueue(
      'inbound.process',
      { webhookEventId: stored.id },
      {
        workspaceId: account.workspaceId,
        dedupeKey: `inbound.process:${event.externalId}`,
      },
    );

    return true;
  }
}

export const metaWebhookService = new MetaWebhookService();
