/**
 * Guardrails de conteúdo público.
 *
 * Um agente de vendas erra de um jeito específico e previsível: promete
 * resultado, inventa preço e manda link que ninguém cadastrou. As três coisas
 * são caras — a primeira gera problema jurídico, a segunda gera reembolso, a
 * terceira gera denúncia de phishing.
 *
 * Por isso a checagem é **determinística e roda depois do modelo**: pedir "não
 * prometa resultados" no prompt reduz a chance, não elimina. O que sai para o
 * público passa por aqui.
 */

export type GuardrailCode =
  | 'GUARANTEED_RESULT'
  | 'FORBIDDEN_TERM'
  | 'PRICE_NOT_IN_CATALOG'
  | 'UNKNOWN_LINK'
  | 'SENSITIVE_DATA_REQUEST'
  | 'TOO_LONG';

/**
 * `type` e não `interface`: a violação é gravada em coluna Json (a mensagem
 * retida guarda o motivo), e o Prisma só aceita tipos com índice implícito.
 */
export type GuardrailViolation = {
  code: GuardrailCode;
  /** BLOCK impede o envio; WARN só aparece no painel. */
  severity: 'BLOCK' | 'WARN';
  message: string;
  excerpt?: string;
};

export interface GuardrailContext {
  /** Termos proibidos pela marca (`BrandProfile.doNotSay`). */
  doNotSay: string[];
  /** Preços em centavos que o agente pode citar (catálogo de produtos). */
  allowedPriceCents: number[];
  /** Domínios/URLs que o agente pode enviar (checkout, agendamento, site). */
  allowedUrls: string[];
  maxLength?: number;
}

/** Promessa de resultado — o erro mais caro que um agente de vendas comete. */
const GUARANTEE_PATTERNS: readonly RegExp[] = [
  /\bresultado[s]?\s+garantid/i,
  /\bgarant\w*\s+(?:o\s+)?(?:seu\s+)?(?:resultado|lucro|retorno|faturamento|emagrecimento|aprovação|cura)/i,
  /\b(?:lucro|retorno|faturamento|ganho)\s+(?:certo|garantid)/i,
  /\b100%\s*(?:de\s*)?(?:garantia\s+de\s+)?(?:resultado|retorno|lucro|sucesso)/i,
  /\bvocê\s+vai\s+(?:ganhar|faturar|lucrar)\s+R\$/i,
  /\bsem\s+risco\s+(?:nenhum|algum)\b/i,
];

/** Pedido de dado sensível — nenhum agente nosso pede isso por DM. */
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /\b(?:seu\s+)?cpf\b/i,
  /\bcart[ãa]o\s+de\s+cr[ée]dito\b/i,
  /\bn[úu]mero\s+do\s+cart[ãa]o\b/i,
  /\bc[óo]digo\s+de\s+seguran[çc]a\b/i,
  /\bsenha\b/i,
  /\bpix\s+(?:para|pra)\s+(?:a\s+)?chave\b/i,
];

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/gi;
const MONEY_PATTERN = /R\$\s*([\d.]+(?:,\d{1,2})?)/gi;

export function checkPublicText(
  text: string,
  ctx: GuardrailContext,
): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];

  for (const pattern of GUARANTEE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      violations.push({
        code: 'GUARANTEED_RESULT',
        severity: 'BLOCK',
        message:
          'O texto promete resultado. Nenhuma comunicação pode garantir ' +
          'resultado que não dependa só da empresa.',
        excerpt: match[0],
      });
      break;
    }
  }

  for (const pattern of SENSITIVE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      violations.push({
        code: 'SENSITIVE_DATA_REQUEST',
        severity: 'BLOCK',
        message:
          'O texto pede dado sensível. Pagamento e dados pessoais só no ' +
          'checkout oficial, nunca por mensagem.',
        excerpt: match[0],
      });
      break;
    }
  }

  const lowered = text.toLowerCase();

  for (const term of ctx.doNotSay) {
    const normalized = term.trim().toLowerCase();
    if (normalized.length > 0 && lowered.includes(normalized)) {
      violations.push({
        code: 'FORBIDDEN_TERM',
        severity: 'BLOCK',
        message: `O texto usa um termo proibido pela marca: "${term}".`,
        excerpt: term,
      });
    }
  }

  // Preço citado precisa existir no catálogo. Modelo de linguagem arredonda
  // número com naturalidade assustadora — R$ 497 vira R$ 499 sem aviso.
  for (const match of text.matchAll(MONEY_PATTERN)) {
    const cents = parseBrlToCents(match[1] ?? '');

    if (cents === null) continue;

    if (!ctx.allowedPriceCents.includes(cents)) {
      violations.push({
        code: 'PRICE_NOT_IN_CATALOG',
        severity: 'BLOCK',
        message:
          `O texto cita ${match[0]}, que não corresponde a nenhum preço ` +
          'cadastrado. O agente não pode inventar nem arredondar preço.',
        excerpt: match[0],
      });
    }
  }

  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0];

    if (!isAllowedUrl(url, ctx.allowedUrls)) {
      violations.push({
        code: 'UNKNOWN_LINK',
        severity: 'BLOCK',
        message:
          `O texto envia um link não cadastrado (${url}). Só links de ` +
          'checkout, agendamento ou site oficial podem ser enviados.',
        excerpt: url,
      });
    }
  }

  if (ctx.maxLength !== undefined && text.length > ctx.maxLength) {
    violations.push({
      code: 'TOO_LONG',
      severity: 'WARN',
      message: `O texto tem ${text.length} caracteres (limite ${ctx.maxLength}).`,
    });
  }

  return violations;
}

export function hasBlockingViolation(
  violations: readonly GuardrailViolation[],
): boolean {
  return violations.some((v) => v.severity === 'BLOCK');
}

export function describeViolations(
  violations: readonly GuardrailViolation[],
): string {
  return violations.map((v) => `[${v.code}] ${v.message}`).join(' ');
}

/** "1.234,56" -> 123456. Formato pt-BR: ponto é milhar, vírgula é decimal. */
function parseBrlToCents(raw: string): number | null {
  const cleaned = raw.replace(/\./g, '').replace(',', '.');
  const value = Number(cleaned);

  if (!Number.isFinite(value)) return null;

  return Math.round(value * 100);
}

function isAllowedUrl(url: string, allowed: readonly string[]): boolean {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  return allowed.some((candidate) => {
    let allowedUrl: URL;

    try {
      allowedUrl = new URL(candidate);
    } catch {
      return false;
    }

    // Mesmo host e caminho compatível: o cadastro do checkout autoriza também
    // os parâmetros de rastreio que a plataforma acrescenta.
    return (
      parsed.host === allowedUrl.host &&
      parsed.pathname.startsWith(allowedUrl.pathname.replace(/\/$/, ''))
    );
  });
}
