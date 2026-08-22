import { describe, expect, it } from 'vitest';
import {
  checkPublicText,
  hasBlockingViolation,
  type GuardrailContext,
} from '@/server/growth/policy/guardrails';

function context(overrides: Partial<GuardrailContext> = {}): GuardrailContext {
  return {
    doNotSay: ['fórmula secreta'],
    allowedPriceCents: [49700],
    allowedUrls: ['https://pagamento.exemplo/checkout/consultoria'],
    ...overrides,
  };
}

describe('guardrails de conteúdo público', () => {
  it('aprova mensagem correta', () => {
    const violations = checkPublicText(
      'A consultoria custa R$ 497,00 e o link é https://pagamento.exemplo/checkout/consultoria',
      context(),
    );

    expect(violations).toHaveLength(0);
  });

  it('bloqueia promessa de resultado', () => {
    const frases = [
      'Com o método você tem resultados garantidos em 30 dias.',
      'Garantimos o seu retorno em três meses.',
      'Lucro certo com a nossa consultoria.',
      '100% de retorno no primeiro mês.',
    ];

    for (const frase of frases) {
      const violations = checkPublicText(frase, context());

      expect(
        violations.some((v) => v.code === 'GUARANTEED_RESULT'),
        frase,
      ).toBe(true);
      expect(hasBlockingViolation(violations)).toBe(true);
    }
  });

  it('bloqueia preço que não está no catálogo', () => {
    const violations = checkPublicText('Sai por R$ 499,00 hoje.', context());

    expect(violations[0]?.code).toBe('PRICE_NOT_IN_CATALOG');
  });

  it('aceita o preço do catálogo em qualquer formatação equivalente', () => {
    expect(checkPublicText('R$ 497,00', context())).toHaveLength(0);
    expect(checkPublicText('R$497', context())).toHaveLength(0);
  });

  it('bloqueia link não cadastrado', () => {
    const violations = checkPublicText(
      'Compre em https://outro-site.exemplo/pagar',
      context(),
    );

    expect(violations[0]?.code).toBe('UNKNOWN_LINK');
  });

  it('aceita o link cadastrado com parâmetros de rastreio', () => {
    const violations = checkPublicText(
      'https://pagamento.exemplo/checkout/consultoria?utm_source=instagram',
      context(),
    );

    expect(violations).toHaveLength(0);
  });

  it('bloqueia pedido de dado sensível', () => {
    const violations = checkPublicText(
      'Me manda o número do cartão para eu finalizar.',
      context(),
    );

    expect(violations.some((v) => v.code === 'SENSITIVE_DATA_REQUEST')).toBe(true);
  });

  it('bloqueia termo proibido pela marca', () => {
    const violations = checkPublicText(
      'Nossa fórmula secreta resolve isso.',
      context(),
    );

    expect(violations.some((v) => v.code === 'FORBIDDEN_TERM')).toBe(true);
  });

  it('avisa sobre texto longo sem bloquear o envio', () => {
    const violations = checkPublicText('a'.repeat(50), context({ maxLength: 10 }));

    expect(violations[0]?.code).toBe('TOO_LONG');
    expect(violations[0]?.severity).toBe('WARN');
    expect(hasBlockingViolation(violations)).toBe(false);
  });
});
