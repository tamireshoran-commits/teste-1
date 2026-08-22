import { createHash } from 'node:crypto';
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

/**
 * Redes sociais simuladas.
 *
 * Existe por um motivo prático: o App Review da Meta leva semanas, e o sistema
 * inteiro — fila, aprovações, CRM, aprendizado — precisa ser desenvolvido e
 * testado antes disso. **Nada sai daqui para a internet.**
 *
 * Todo retorno carrega `isMock: true`, e a interface é obrigada a rotular. O
 * dia em que um número simulado aparecer no painel como se fosse real, o
 * relatório de desempenho vira ficção.
 */
export class MockSocialProvider implements SocialPublisher, SocialMessenger {
  readonly name = 'mock';

  /** Chamadas registradas, para inspeção em testes. */
  readonly published: PublishInput[] = [];
  readonly sent: Array<{ kind: string; to: string; text: string }> = [];

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async publish(input: PublishInput): Promise<PublishOutput> {
    this.published.push(input);

    const id = `mock_${hash(input.caption + input.account.externalId)}`;

    return {
      externalPostId: id,
      permalink: `https://example.invalid/mock/${id}`,
      isMock: true,
    };
  }

  /**
   * Métricas determinísticas derivadas do id da publicação.
   *
   * Determinístico e não aleatório de propósito: o módulo de aprendizado
   * precisa de números estáveis para ser testável, e um valor que muda a cada
   * coleta tornaria impossível verificar se a agregação está correta.
   */
  async fetchMetrics(input: {
    account: SocialAccountRef;
    externalPostId: string;
  }): Promise<MetricsSnapshot> {
    const seed = Number.parseInt(hash(input.externalPostId).slice(0, 6), 16);
    const reach = 200 + (seed % 1800);

    return {
      impressions: Math.round(reach * 1.35),
      reach,
      likes: Math.round(reach * 0.06),
      comments: Math.round(reach * 0.012),
      shares: Math.round(reach * 0.008),
      saves: Math.round(reach * 0.01),
      videoViews: Math.round(reach * 0.9),
      linkClicks: Math.round(reach * 0.02),
      profileVisits: Math.round(reach * 0.03),
      raw: { simulado: true },
      isMock: true,
    };
  }

  async fetchComments(): Promise<InboundComment[]> {
    // Comentário simulado entraria no CRM como pessoa real. Não vale o risco:
    // para testar a ingestão, use o endpoint de simulação de webhook.
    return [];
  }

  async sendDirectMessage(input: {
    account: SocialAccountRef;
    recipientExternalId: string;
    text: string;
  }): Promise<SendResult> {
    this.sent.push({
      kind: 'DM',
      to: input.recipientExternalId,
      text: input.text,
    });

    return { externalMessageId: `mock_dm_${hash(input.text)}`, isMock: true };
  }

  async replyToComment(input: {
    account: SocialAccountRef;
    commentExternalId: string;
    text: string;
  }): Promise<SendResult> {
    this.sent.push({
      kind: 'COMMENT_REPLY',
      to: input.commentExternalId,
      text: input.text,
    });

    return { externalMessageId: `mock_reply_${hash(input.text)}`, isMock: true };
  }

  async sendPrivateReply(input: {
    account: SocialAccountRef;
    commentExternalId: string;
    text: string;
  }): Promise<SendResult> {
    this.sent.push({
      kind: 'PRIVATE_REPLY',
      to: input.commentExternalId,
      text: input.text,
    });

    return {
      externalMessageId: `mock_private_${hash(input.text)}`,
      isMock: true,
    };
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
