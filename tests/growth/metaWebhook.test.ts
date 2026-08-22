import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normalizeMetaWebhook } from '@/server/growth/webhooks/metaEvents';
import {
  verifyChallenge,
  verifyMetaSignature,
} from '@/server/growth/webhooks/metaSignature';

const SECRET = 'segredo-de-teste';

function sign(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')}`;
}

describe('assinatura do webhook', () => {
  const body = JSON.stringify({ object: 'instagram', entry: [] });

  it('aceita assinatura válida', () => {
    expect(
      verifyMetaSignature({
        rawBody: body,
        signatureHeader: sign(body),
        appSecret: SECRET,
      }),
    ).toBe(true);
  });

  it('recusa corpo adulterado', () => {
    expect(
      verifyMetaSignature({
        rawBody: `${body} `,
        signatureHeader: sign(body),
        appSecret: SECRET,
      }),
    ).toBe(false);
  });

  it('recusa assinatura ausente, vazia ou com outro algoritmo', () => {
    for (const header of [null, '', 'sha1=abc', 'abc']) {
      expect(
        verifyMetaSignature({
          rawBody: body,
          signatureHeader: header,
          appSecret: SECRET,
        }),
      ).toBe(false);
    }
  });

  it('recusa assinatura de outro segredo', () => {
    const outra = `sha256=${createHmac('sha256', 'outro').update(body).digest('hex')}`;

    expect(
      verifyMetaSignature({
        rawBody: body,
        signatureHeader: outra,
        appSecret: SECRET,
      }),
    ).toBe(false);
  });

  it('devolve o desafio só com o token correto', () => {
    expect(
      verifyChallenge({
        mode: 'subscribe',
        token: 'tok',
        challenge: '12345',
        verifyToken: 'tok',
      }),
    ).toBe('12345');

    expect(
      verifyChallenge({
        mode: 'subscribe',
        token: 'errado',
        challenge: '12345',
        verifyToken: 'tok',
      }),
    ).toBeNull();
  });
});

describe('normalização de eventos da Meta', () => {
  it('lê mensagem direta do Instagram', () => {
    const events = normalizeMetaWebhook({
      object: 'instagram',
      entry: [
        {
          id: 'ig-conta-1',
          time: 1_770_000_000,
          messaging: [
            {
              sender: { id: 'pessoa-1' },
              recipient: { id: 'ig-conta-1' },
              timestamp: 1_770_000_000_000,
              message: { mid: 'mid-1', text: 'quanto custa?' },
            },
          ],
        },
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      platform: 'INSTAGRAM',
      channel: 'IG_DM',
      externalId: 'mid-1',
      contactExternalId: 'pessoa-1',
      recipientExternalId: 'ig-conta-1',
      text: 'quanto custa?',
    });
  });

  it('ignora eco da própria mensagem', () => {
    const events = normalizeMetaWebhook({
      object: 'instagram',
      entry: [
        {
          id: 'ig-conta-1',
          messaging: [
            {
              sender: { id: 'ig-conta-1' },
              recipient: { id: 'pessoa-1' },
              message: { mid: 'mid-2', text: 'oi', is_echo: true },
            },
          ],
        },
      ],
    });

    expect(events).toHaveLength(0);
  });

  it('lê comentário do Instagram com o post de origem', () => {
    const events = normalizeMetaWebhook({
      object: 'instagram',
      entry: [
        {
          id: 'ig-conta-1',
          changes: [
            {
              field: 'comments',
              value: {
                id: 'comment-1',
                text: 'quero saber mais',
                from: { id: 'pessoa-2', username: 'fulana' },
                media: { id: 'post-9' },
              },
            },
          ],
        },
      ],
    });

    expect(events[0]).toMatchObject({
      channel: 'IG_COMMENT',
      externalId: 'comment-1',
      contactUsername: 'fulana',
      sourceExternalPostId: 'post-9',
    });
  });

  it('lê comentário de Página dentro do tópico feed', () => {
    const events = normalizeMetaWebhook({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: 'c-1',
                message: 'tem desconto?',
                post_id: 'p-1',
                from: { id: 'pessoa-3', name: 'Beltrano' },
              },
            },
          ],
        },
      ],
    });

    expect(events[0]).toMatchObject({
      platform: 'FACEBOOK',
      channel: 'FB_COMMENT',
      externalId: 'c-1',
      sourceExternalPostId: 'p-1',
    });
  });

  it('ignora curtida e outros itens do feed', () => {
    const events = normalizeMetaWebhook({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          changes: [
            { field: 'feed', value: { item: 'like', verb: 'add', post_id: 'p-1' } },
          ],
        },
      ],
    });

    expect(events).toHaveLength(0);
  });

  it('não quebra com corpo inesperado', () => {
    expect(normalizeMetaWebhook(null)).toEqual([]);
    expect(normalizeMetaWebhook({})).toEqual([]);
    expect(normalizeMetaWebhook({ entry: [{}] })).toEqual([]);
  });
});
