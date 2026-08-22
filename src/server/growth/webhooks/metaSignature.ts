import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verificação da assinatura do webhook da Meta.
 *
 * O endpoint é público: sem esta checagem, qualquer um pode inventar um
 * comentário e fazer o agente responder — e, no modo autônomo, enviar mensagem
 * em nome da marca. A comparação é em tempo constante porque comparação de
 * string com saída antecipada vaza o segredo byte a byte.
 */
export function verifyMetaSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
  appSecret: string;
}): boolean {
  const header = input.signatureHeader?.trim();

  if (header === undefined || header === '') return false;

  const [algorithm, received] = header.split('=');

  if (algorithm !== 'sha256' || received === undefined) return false;

  const expected = createHmac('sha256', input.appSecret)
    .update(input.rawBody, 'utf8')
    .digest('hex');

  const receivedBuffer = Buffer.from(received, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  if (receivedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

/**
 * Verificação inicial do webhook (`hub.mode=subscribe`).
 *
 * A Meta chama uma vez, no cadastro, e espera o `hub.challenge` de volta —
 * mas só se o token bater com o configurado no app.
 */
export function verifyChallenge(input: {
  mode: string | null;
  token: string | null;
  challenge: string | null;
  verifyToken: string;
}): string | null {
  if (input.mode !== 'subscribe') return null;
  if (input.token === null || input.token !== input.verifyToken) return null;

  return input.challenge;
}
