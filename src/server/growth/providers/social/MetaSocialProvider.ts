import { ProviderError, ProviderUnavailableError } from '@/server/core/shared/errors';
import { logger } from '@/server/core/shared/logger';
import type { MetaGraphClient } from './MetaGraphClient';
import type {
  InboundComment,
  MetricsSnapshot,
  PublishInput,
  PublishOutput,
  SendResult,
  SocialAccountRef,
  SocialMessenger,
  SocialPublisher,
} from './SocialProvider';

const log = logger.child('meta-social');

/**
 * Publicação e mensageria via APIs oficiais da Meta.
 *
 * Pré-requisitos que **não são código** e sem os quais nada aqui funciona:
 * conta Instagram Business/Creator vinculada a uma Página, app com as
 * permissões aprovadas no App Review (publicação, comentários e mensagens são
 * permissões distintas) e token de longa duração.
 *
 * Os endpoints seguem a Graph API na versão configurada em
 * `META_GRAPH_VERSION`. **Confirme na documentação vigente antes do go-live**:
 * a Meta muda nomes de métrica e limites com frequência, e este arquivo é o
 * único lugar do sistema que precisa acompanhar essa mudança.
 */
export class MetaSocialProvider implements SocialPublisher, SocialMessenger {
  readonly name = 'meta';

  constructor(
    private readonly client: MetaGraphClient,
    private readonly options: {
      /** Intervalo entre checagens do container de vídeo. */
      pollIntervalMs?: number;
      pollAttempts?: number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ) {}

  async isAvailable(account: SocialAccountRef): Promise<boolean> {
    return account.accessToken !== null && account.accessToken.trim() !== '';
  }

  // ---------------------------------------------------------------------------
  // Publicação
  // ---------------------------------------------------------------------------

  async publish(input: PublishInput): Promise<PublishOutput> {
    const token = requireToken(input.account);

    return input.account.platform === 'INSTAGRAM'
      ? this.publishToInstagram(input, token)
      : this.publishToFacebook(input, token);
  }

  /**
   * Instagram publica em duas etapas: cria um "container" com a mídia e só
   * depois publica. Vídeo leva alguns segundos para ser processado, e publicar
   * antes de o container ficar pronto devolve erro — daí o polling.
   */
  private async publishToInstagram(
    input: PublishInput,
    token: string,
  ): Promise<PublishOutput> {
    const igUserId = input.account.externalId;

    if (input.mediaUrl === null || input.mediaKind === 'NONE') {
      throw new ProviderError(
        'O Instagram não aceita publicação sem mídia. Gere a imagem ou o ' +
          'vídeo da peça antes de publicar.',
        { provider: this.name, retryable: false },
      );
    }

    const container: Record<string, string> = { caption: input.caption };

    if (input.mediaKind === 'VIDEO') {
      container['media_type'] = input.format === 'STORY' ? 'STORIES' : 'REELS';
      container['video_url'] = input.mediaUrl;
    } else {
      if (input.format === 'STORY') container['media_type'] = 'STORIES';
      container['image_url'] = input.mediaUrl;
    }

    const created = await this.client.post<{ id: string }>(
      `${igUserId}/media`,
      container,
      token,
    );

    if (input.mediaKind === 'VIDEO') {
      await this.waitForContainer(created.id, token);
    }

    const published = await this.client.post<{ id: string }>(
      `${igUserId}/media_publish`,
      { creation_id: created.id },
      token,
    );

    const permalink = await this.fetchPermalink(
      published.id,
      'permalink',
      token,
    );

    return { externalPostId: published.id, permalink, isMock: false };
  }

  private async publishToFacebook(
    input: PublishInput,
    token: string,
  ): Promise<PublishOutput> {
    const pageId = input.account.pageId ?? input.account.externalId;

    let response: { id?: string; post_id?: string };

    if (input.mediaKind === 'VIDEO' && input.mediaUrl !== null) {
      response = await this.client.post<{ id: string }>(
        `${pageId}/videos`,
        { file_url: input.mediaUrl, description: input.caption },
        token,
      );
    } else if (input.mediaKind === 'IMAGE' && input.mediaUrl !== null) {
      response = await this.client.post<{ id: string; post_id?: string }>(
        `${pageId}/photos`,
        { url: input.mediaUrl, caption: input.caption, published: 'true' },
        token,
      );
    } else {
      response = await this.client.post<{ id: string }>(
        `${pageId}/feed`,
        { message: input.caption },
        token,
      );
    }

    const postId = response.post_id ?? response.id;

    if (postId === undefined) {
      throw new ProviderError(
        'A Meta respondeu sem o id da publicação.',
        { provider: this.name, retryable: true },
      );
    }

    const permalink = await this.fetchPermalink(postId, 'permalink_url', token);

    return { externalPostId: postId, permalink, isMock: false };
  }

  private async waitForContainer(
    creationId: string,
    token: string,
  ): Promise<void> {
    const attempts = this.options.pollAttempts ?? 20;
    const intervalMs = this.options.pollIntervalMs ?? 3000;
    const sleep =
      this.options.sleep ??
      ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    for (let attempt = 0; attempt < attempts; attempt++) {
      const status = await this.client.get<{ status_code?: string }>(
        creationId,
        { fields: 'status_code' },
        token,
      );

      if (status.status_code === 'FINISHED') return;

      if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
        throw new ProviderError(
          `A Meta não conseguiu processar o vídeo (status ${status.status_code}). ` +
            'Verifique formato, duração e tamanho do arquivo.',
          { provider: this.name, retryable: false },
        );
      }

      await sleep(intervalMs);
    }

    throw new ProviderError(
      'O vídeo ainda estava sendo processado pela Meta quando o tempo se ' +
        'esgotou. O job será retentado.',
      { provider: this.name, retryable: true },
    );
  }

  private async fetchPermalink(
    postId: string,
    field: 'permalink' | 'permalink_url',
    token: string,
  ): Promise<string | null> {
    try {
      const result = await this.client.get<Record<string, string>>(
        postId,
        { fields: field },
        token,
      );

      return result[field] ?? null;
    } catch (error) {
      // A publicação já aconteceu: não ter o link não pode reverter isso.
      log.warn('publicação feita, mas sem permalink', { postId, error });
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Métricas
  // ---------------------------------------------------------------------------

  async fetchMetrics(input: {
    account: SocialAccountRef;
    externalPostId: string;
  }): Promise<MetricsSnapshot> {
    const token = requireToken(input.account);

    const metrics =
      input.account.platform === 'INSTAGRAM'
        ? 'reach,likes,comments,saved,shares,views'
        : 'post_impressions,post_impressions_unique,post_clicks';

    try {
      const response = await this.client.get<{
        data?: Array<{ name: string; values?: Array<{ value?: number }> }>;
      }>(`${input.externalPostId}/insights`, { metric: metrics }, token);

      return toSnapshot(readInsights(response.data ?? []), response);
    } catch (error) {
      // Métrica indisponível para o tipo de mídia derruba a chamada inteira.
      // Os contadores básicos do próprio objeto continuam servindo, e é
      // melhor um dado parcial e verdadeiro do que nenhum.
      log.warn('insights indisponíveis; usando contadores básicos', { error });

      const basic = await this.client.get<{
        like_count?: number;
        comments_count?: number;
      }>(input.externalPostId, { fields: 'like_count,comments_count' }, token);

      return toSnapshot(
        {
          likes: basic.like_count ?? 0,
          comments: basic.comments_count ?? 0,
        },
        basic,
      );
    }
  }

  async fetchComments(input: {
    account: SocialAccountRef;
    externalPostId: string;
  }): Promise<InboundComment[]> {
    const token = requireToken(input.account);

    const fields =
      input.account.platform === 'INSTAGRAM'
        ? 'id,text,timestamp,username,from'
        : 'id,message,created_time,from';

    const response = await this.client.get<{
      data?: Array<{
        id: string;
        text?: string;
        message?: string;
        timestamp?: string;
        created_time?: string;
        username?: string;
        from?: { id?: string; name?: string; username?: string };
      }>;
    }>(`${input.externalPostId}/comments`, { fields, limit: '50' }, token);

    return (response.data ?? []).map((comment) => ({
      externalId: comment.id,
      text: comment.text ?? comment.message ?? '',
      authorExternalId: comment.from?.id ?? comment.id,
      authorUsername:
        comment.username ?? comment.from?.username ?? comment.from?.name ?? null,
      createdAt: new Date(comment.timestamp ?? comment.created_time ?? Date.now()),
    }));
  }

  // ---------------------------------------------------------------------------
  // Mensageria
  // ---------------------------------------------------------------------------

  async sendDirectMessage(input: {
    account: SocialAccountRef;
    recipientExternalId: string;
    text: string;
  }): Promise<SendResult> {
    const token = requireToken(input.account);
    const senderId = messagingSenderId(input.account);

    const response = await this.client.post<{ message_id?: string }>(
      `${senderId}/messages`,
      {
        recipient: JSON.stringify({ id: input.recipientExternalId }),
        message: JSON.stringify({ text: input.text }),
        messaging_type: 'RESPONSE',
      },
      token,
    );

    return {
      externalMessageId: response.message_id ?? `${Date.now()}`,
      isMock: false,
    };
  }

  async replyToComment(input: {
    account: SocialAccountRef;
    commentExternalId: string;
    text: string;
  }): Promise<SendResult> {
    const token = requireToken(input.account);

    const response = await this.client.post<{ id: string }>(
      `${input.commentExternalId}/replies`,
      { message: input.text },
      token,
    );

    return { externalMessageId: response.id, isMock: false };
  }

  async sendPrivateReply(input: {
    account: SocialAccountRef;
    commentExternalId: string;
    text: string;
  }): Promise<SendResult> {
    const token = requireToken(input.account);
    const senderId = messagingSenderId(input.account);

    const response = await this.client.post<{ message_id?: string }>(
      `${senderId}/messages`,
      {
        recipient: JSON.stringify({ comment_id: input.commentExternalId }),
        message: JSON.stringify({ text: input.text }),
      },
      token,
    );

    return {
      externalMessageId: response.message_id ?? `${Date.now()}`,
      isMock: false,
    };
  }
}

function requireToken(account: SocialAccountRef): string {
  if (account.accessToken === null || account.accessToken.trim() === '') {
    throw new ProviderUnavailableError(
      'meta',
      `a conta ${account.platform} ${account.externalId} não tem token ` +
        'configurado. Aponte `tokenRef` para a variável de ambiente que ' +
        'guarda o token de longa duração.',
    );
  }

  return account.accessToken;
}

/** Instagram envia mensagem pelo próprio IG User ID; Facebook, pela Página. */
function messagingSenderId(account: SocialAccountRef): string {
  return account.platform === 'INSTAGRAM'
    ? account.externalId
    : (account.pageId ?? account.externalId);
}

function readInsights(
  data: ReadonlyArray<{ name: string; values?: Array<{ value?: number }> }>,
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const metric of data) {
    result[metric.name] = metric.values?.[0]?.value ?? 0;
  }

  return result;
}

function toSnapshot(
  values: Record<string, number>,
  raw: unknown,
): MetricsSnapshot {
  const pick = (...keys: string[]): number => {
    for (const key of keys) {
      const value = values[key];
      if (typeof value === 'number') return value;
    }
    return 0;
  };

  return {
    impressions: pick('impressions', 'post_impressions', 'views'),
    reach: pick('reach', 'post_impressions_unique'),
    likes: pick('likes'),
    comments: pick('comments'),
    shares: pick('shares'),
    saves: pick('saved'),
    videoViews: pick('views', 'plays', 'video_views'),
    linkClicks: pick('post_clicks', 'website_clicks'),
    profileVisits: pick('profile_visits'),
    raw,
    isMock: false,
  };
}
