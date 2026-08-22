import type { ConversationChannel, SocialPlatform } from '../types';

/**
 * Normalização dos eventos da Meta.
 *
 * A Graph API entrega comentário e mensagem em formatos completamente
 * diferentes, e o do Instagram não é igual ao da Página. Todo o resto do
 * sistema fala uma língua só — `NormalizedEvent` — e este arquivo é o único
 * que precisa saber disso.
 */

export interface NormalizedEvent {
  platform: SocialPlatform;
  channel: ConversationChannel;
  /** Id do evento na origem: chave de idempotência. */
  externalId: string;
  /** Conta que recebeu a interação (IG User ID ou Page ID). */
  recipientExternalId: string;
  contactExternalId: string;
  contactUsername: string | null;
  text: string;
  occurredAt: Date;
  /** Post que originou a interação, quando é comentário. */
  sourceExternalPostId: string | null;
  topic: string;
}

interface WebhookEntry {
  id?: string;
  time?: number;
  changes?: Array<{ field?: string; value?: Record<string, unknown> }>;
  messaging?: Array<Record<string, unknown>>;
}

interface WebhookPayload {
  object?: string;
  entry?: WebhookEntry[];
}

export function normalizeMetaWebhook(payload: unknown): NormalizedEvent[] {
  const body = payload as WebhookPayload | null;

  if (body === null || typeof body !== 'object') return [];

  const platform: SocialPlatform =
    body.object === 'instagram' ? 'INSTAGRAM' : 'FACEBOOK';

  const events: NormalizedEvent[] = [];

  for (const entry of body.entry ?? []) {
    const recipientId = entry.id ?? '';

    for (const messaging of entry.messaging ?? []) {
      const event = normalizeMessaging(messaging, platform, recipientId);
      if (event) events.push(event);
    }

    for (const change of entry.changes ?? []) {
      const event = normalizeChange(change, platform, recipientId, entry.time);
      if (event) events.push(event);
    }
  }

  return events;
}

function normalizeMessaging(
  messaging: Record<string, unknown>,
  platform: SocialPlatform,
  recipientId: string,
): NormalizedEvent | null {
  const message = messaging['message'] as
    | { mid?: string; text?: string; is_echo?: boolean }
    | undefined;

  if (message === undefined || typeof message.text !== 'string') return null;

  // Eco é a nossa própria mensagem voltando; processá-la faria o agente
  // responder a si mesmo.
  if (message.is_echo === true) return null;

  const sender = messaging['sender'] as { id?: string } | undefined;
  const senderId = sender?.id;

  if (senderId === undefined || senderId === recipientId) return null;

  const timestamp = messaging['timestamp'];

  return {
    platform,
    channel: platform === 'INSTAGRAM' ? 'IG_DM' : 'FB_MESSENGER',
    externalId: message.mid ?? `${senderId}:${String(timestamp)}`,
    recipientExternalId: recipientId,
    contactExternalId: senderId,
    contactUsername: null,
    text: message.text,
    occurredAt: toDate(timestamp),
    sourceExternalPostId: null,
    topic: 'messages',
  };
}

function normalizeChange(
  change: { field?: string; value?: Record<string, unknown> },
  platform: SocialPlatform,
  recipientId: string,
  entryTime: number | undefined,
): NormalizedEvent | null {
  const value = change.value;
  if (value === undefined) return null;

  const field = change.field ?? '';

  if (field === 'comments' || field === 'live_comments') {
    const from = value['from'] as
      | { id?: string; username?: string; name?: string }
      | undefined;

    const media = value['media'] as { id?: string } | undefined;
    const text = value['text'];
    const id = value['id'];

    if (typeof id !== 'string' || typeof text !== 'string') return null;

    return {
      platform,
      channel: platform === 'INSTAGRAM' ? 'IG_COMMENT' : 'FB_COMMENT',
      externalId: id,
      recipientExternalId: recipientId,
      contactExternalId: from?.id ?? id,
      contactUsername: from?.username ?? from?.name ?? null,
      text,
      occurredAt: toDate(value['timestamp'] ?? entryTime),
      sourceExternalPostId: media?.id ?? null,
      topic: field,
    };
  }

  // Página: comentários chegam dentro do tópico `feed`, junto de curtidas e
  // outras ações que não interessam aqui.
  if (field === 'feed' && value['item'] === 'comment' && value['verb'] === 'add') {
    const from = value['from'] as { id?: string; name?: string } | undefined;
    const commentId = value['comment_id'];
    const message = value['message'];

    if (typeof commentId !== 'string' || typeof message !== 'string') return null;

    return {
      platform: 'FACEBOOK',
      channel: 'FB_COMMENT',
      externalId: commentId,
      recipientExternalId: recipientId,
      contactExternalId: from?.id ?? commentId,
      contactUsername: from?.name ?? null,
      text: message,
      occurredAt: toDate(value['created_time'] ?? entryTime),
      sourceExternalPostId:
        typeof value['post_id'] === 'string' ? value['post_id'] : null,
      topic: 'feed',
    };
  }

  return null;
}

/** A Meta usa segundos em uns campos e milissegundos em outros. */
function toDate(value: unknown): Date {
  if (typeof value === 'number') {
    return new Date(value > 1e12 ? value : value * 1000);
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }

  return new Date();
}
