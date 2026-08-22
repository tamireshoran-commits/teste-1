import type { ContentFormat, SocialPlatform } from '../../types';

/**
 * Contratos de integração com as redes sociais.
 *
 * Publicação e mensageria são interfaces separadas porque exigem permissões
 * diferentes na Meta e evoluem em ritmos diferentes: dá para ter um workspace
 * publicando sem ter aprovação para mensagens.
 *
 * Nenhuma implementação pode contornar regra de plataforma. Automação por
 * navegador ou conta pessoal está fora de escopo — o custo de um bloqueio é
 * maior que qualquer ganho de alcance.
 */

export interface SocialAccountRef {
  platform: SocialPlatform;
  /** IG User ID (Instagram) ou Page ID (Facebook). */
  externalId: string;
  /** Página vinculada — o Instagram publica e envia mensagem através dela. */
  pageId: string | null;
  /** Resolvido a partir de `SocialAccount.tokenRef`, nunca lido do banco. */
  accessToken: string | null;
}

export interface PublishInput {
  account: SocialAccountRef;
  format: ContentFormat;
  caption: string;
  /** URL pública da mídia. A Meta baixa o arquivo do nosso servidor. */
  mediaUrl: string | null;
  mediaKind: 'IMAGE' | 'VIDEO' | 'NONE';
}

export interface PublishOutput {
  externalPostId: string;
  permalink: string | null;
  isMock: boolean;
}

export interface MetricsSnapshot {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  videoViews: number;
  linkClicks: number;
  profileVisits: number;
  raw: unknown;
  isMock: boolean;
}

export interface InboundComment {
  externalId: string;
  text: string;
  authorExternalId: string;
  authorUsername: string | null;
  createdAt: Date;
}

export interface SocialPublisher {
  readonly name: string;
  isAvailable(account: SocialAccountRef): Promise<boolean>;
  publish(input: PublishInput): Promise<PublishOutput>;
  fetchMetrics(input: {
    account: SocialAccountRef;
    externalPostId: string;
  }): Promise<MetricsSnapshot>;
  fetchComments(input: {
    account: SocialAccountRef;
    externalPostId: string;
  }): Promise<InboundComment[]>;
}

export interface SendResult {
  externalMessageId: string;
  isMock: boolean;
}

export interface SocialMessenger {
  readonly name: string;
  isAvailable(account: SocialAccountRef): Promise<boolean>;

  /**
   * Mensagem direta. Só é chamada depois de a `MessagingPolicy` aprovar —
   * a implementação não repete a checagem de janela, mas também não a
   * contorna: fora da janela a própria Meta recusa.
   */
  sendDirectMessage(input: {
    account: SocialAccountRef;
    recipientExternalId: string;
    text: string;
  }): Promise<SendResult>;

  /** Resposta pública a um comentário. */
  replyToComment(input: {
    account: SocialAccountRef;
    commentExternalId: string;
    text: string;
  }): Promise<SendResult>;

  /**
   * Mensagem privada a partir de um comentário.
   *
   * A plataforma permite **uma única vez por comentário**. É o caminho
   * legítimo para "iniciar uma conversa": a pessoa comentou, e a resposta
   * privada continua o assunto que ela mesma começou.
   */
  sendPrivateReply(input: {
    account: SocialAccountRef;
    commentExternalId: string;
    text: string;
  }): Promise<SendResult>;
}
