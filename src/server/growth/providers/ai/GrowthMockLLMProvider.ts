import { ProviderError } from '@/server/core/shared/errors';
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '@/server/core/providers/ai/llm/LLMProvider';

/**
 * Modelo simulado do Growth Engine.
 *
 * Existe porque o `MockLLMProvider` genérico falha quando não há resposta
 * registrada — comportamento correto lá, e impeditivo aqui: sem ele, o fluxo
 * inteiro (webhook → qualificação → resposta → follow-up) só roda com chave de
 * API, e ninguém consegue avaliar o sistema antes de gastar.
 *
 * Duas regras que este mock respeita:
 *
 * 1. **Todo texto voltado ao público sai prefixado com "[EXEMPLO]".** Um
 *    rascunho simulado que passe por conteúdo real é pior que erro nenhum.
 * 2. **Nada de preço, link ou promessa.** As respostas passam pelos mesmos
 *    guardrails do modelo real, e é assim que se testa que os guardrails
 *    funcionam sem depender do que o modelo devolveu naquele dia.
 *
 * As respostas variam conforme a mensagem recebida (preço, compra, elogio),
 * o suficiente para exercitar qualificação, objeção e fechamento.
 */
export class GrowthMockLLMProvider implements LLMProvider {
  readonly name = 'mock';
  readonly model = 'mock-model';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async completeJSON<T>(request: LLMRequest<T>): Promise<LLMResponse<T>> {
    const data = resolveResponse(request.prompt);

    if (data === null) {
      throw new ProviderError(
        'GrowthMockLLMProvider não tem resposta simulada para este prompt. ' +
          'Adicione uma em GrowthMockLLMProvider — o mock não improvisa.',
        { provider: this.name, retryable: false },
      );
    }

    return {
      data: request.parse(data),
      usage: { inputTokens: 0, outputTokens: 0 },
      model: this.model,
      raw: data,
    };
  }
}

function resolveResponse(prompt: string): unknown | null {
  if (prompt.includes('Agente 1 — Estrategista de Mercado')) {
    return marketStrategy(prompt);
  }

  if (prompt.includes('Agente 2 — Estrategista de Conteúdo')) {
    return contentPlan();
  }

  if (prompt.includes('Agente 3 — Criador de Vídeos')) {
    return videoBrief(prompt);
  }

  if (prompt.includes('Agente 5 — Qualificador de Leads')) {
    return leadQualification(lastMessage(prompt));
  }

  if (prompt.includes('Agente 6 — Vendedor por IA')) {
    return salesReply(lastMessage(prompt));
  }

  if (prompt.includes('Follow-up contextual')) {
    return followUp();
  }

  if (prompt.includes('Módulo de aprendizado')) {
    return { insights: [] };
  }

  return null;
}

/** Lê a última mensagem recebida a partir da variável já interpolada. */
function lastMessage(prompt: string): string {
  const match = /Última mensagem recebida: (.*)/.exec(prompt);
  return (match?.[1] ?? '').toLowerCase();
}

function extractNiche(prompt: string): string {
  const match = /Nicho declarado: (.*)/.exec(prompt);
  return match?.[1]?.trim() ?? 'nicho não informado';
}

function marketStrategy(prompt: string): unknown {
  const niche = extractNiche(prompt);

  return {
    niche,
    persona: {
      name: '[EXEMPLO] Persona simulada',
      ageRange: '30-45',
      occupation: 'profissional autônomo',
      context:
        '[EXEMPLO] Dado simulado: substitua rodando o agente com uma chave de API configurada.',
      channels: ['Instagram', 'WhatsApp'],
      buyingTriggers: ['recomendação de conhecido', 'prova de resultado'],
    },
    pains: [
      '[EXEMPLO] não sei por onde começar',
      '[EXEMPLO] já tentei e não deu certo',
    ],
    desires: ['[EXEMPLO] previsibilidade', '[EXEMPLO] menos trabalho manual'],
    objections: [
      {
        objection: '[EXEMPLO] está caro para o meu momento',
        response:
          '[EXEMPLO] entendo. Posso te mostrar o que está incluso para você decidir com calma.',
      },
    ],
    competitors: [
      {
        archetype: '[EXEMPLO] concorrente local de baixo preço',
        strengths: ['preço'],
        weaknesses: ['pouca personalização'],
        gap: '[EXEMPLO] atendimento próximo',
      },
    ],
    opportunities: [
      {
        title: '[EXEMPLO] conteúdo respondendo dúvidas frequentes',
        rationale: '[EXEMPLO] hipótese a validar com dados reais.',
        confidence: 0.3,
      },
    ],
    valueProposition:
      '[EXEMPLO] proposta de valor simulada — rode com uma chave de API para obter a real.',
    offer: {
      headline: '[EXEMPLO] oferta simulada',
      promise: '[EXEMPLO] o que está incluso, sem garantir resultado',
      deliverables: ['[EXEMPLO] entrega 1', '[EXEMPLO] entrega 2'],
      priceHypothesis: 'usar preço cadastrado',
      riskReversal: 'nenhuma',
    },
    toneOfVoice: 'Direto, próximo e sem jargão.',
    hypotheses: [
      'Tudo nesta estratégia é simulado e precisa ser refeito com um modelo real.',
    ],
  };
}

function contentPlan(): unknown {
  const pieces = [
    {
      objective: 'REACH',
      format: 'REEL',
      funnelStage: 'AWARENESS',
      audience: '[EXEMPLO] quem ainda não conhece a marca',
      theme: '[EXEMPLO] erro comum do nicho',
      hook: '[EXEMPLO] o erro que quase todo mundo comete no começo',
      script: '[EXEMPLO] roteiro simulado em três blocos de fala.',
      caption: '[EXEMPLO] legenda simulada. Salve para depois.',
      cta: 'Comenta aqui a sua dúvida',
      keywords: ['exemplo'],
      dayOffset: 0,
      rationale: 'Conteúdo simulado para exercitar o fluxo.',
    },
    {
      objective: 'LEADS',
      format: 'CAROUSEL',
      funnelStage: 'INTEREST',
      audience: '[EXEMPLO] quem já sente a dor',
      theme: '[EXEMPLO] passo a passo inicial',
      hook: '[EXEMPLO] o primeiro passo que ninguém te conta',
      script: '[EXEMPLO] roteiro simulado do carrossel.',
      caption: '[EXEMPLO] legenda simulada com convite à conversa.',
      cta: 'Me chama no direct para eu te explicar',
      keywords: ['exemplo'],
      dayOffset: 3,
      rationale: 'Conteúdo simulado para exercitar o fluxo.',
    },
    {
      objective: 'SALES',
      format: 'REEL',
      funnelStage: 'DECISION',
      audience: '[EXEMPLO] quem já comparou opções',
      theme: '[EXEMPLO] como funciona o atendimento',
      hook: '[EXEMPLO] como funciona por dentro',
      script: '[EXEMPLO] roteiro simulado mostrando o processo.',
      caption: '[EXEMPLO] legenda simulada explicando o processo.',
      cta: 'Chama no direct para ver se faz sentido para você',
      keywords: ['exemplo'],
      dayOffset: 6,
      rationale: 'Conteúdo simulado para exercitar o fluxo.',
    },
  ];

  return {
    pillars: [
      {
        name: '[EXEMPLO] Educação',
        description: 'Explica o problema',
        share: 0.5,
      },
      { name: '[EXEMPLO] Prova', description: 'Mostra o processo', share: 0.5 },
    ],
    pieces,
  };
}

function videoBrief(prompt: string): unknown {
  const theme = /Tema: (.*)/.exec(prompt)?.[1]?.trim() ?? 'tema simulado';

  return {
    totalDurationSec: 30,
    aspectRatio: '9:16',
    scenes: [
      {
        index: 1,
        durationSec: 5,
        visualPrompt: `[EXEMPLO] plano médio, ambiente iluminado, pessoa falando sobre ${theme}`,
        narration: '[EXEMPLO] abertura simulada.',
        onScreenText: '[EXEMPLO]',
        bRoll: 'nenhum',
      },
      {
        index: 2,
        durationSec: 15,
        visualPrompt: '[EXEMPLO] plano fechado, detalhe do processo',
        narration: '[EXEMPLO] desenvolvimento simulado.',
        onScreenText: '[EXEMPLO]',
        bRoll: 'nenhum',
      },
      {
        index: 3,
        durationSec: 10,
        visualPrompt: '[EXEMPLO] plano aberto, encerramento',
        narration: '[EXEMPLO] chamada para ação simulada.',
        onScreenText: '[EXEMPLO]',
        bRoll: 'nenhum',
      },
    ],
    narrationScript:
      '[EXEMPLO] narração simulada. Configure um provedor real para gerar a versão final.',
    captions: [{ startSec: 0, endSec: 3, text: '[EXEMPLO] legenda' }],
    thumbnailPrompt: `[EXEMPLO] thumbnail sobre ${theme}`,
    hashtags: ['#exemplo'],
    musicMood: 'neutro',
  };
}

/** Palavras que indicam intenção, na ordem do mais forte para o mais fraco. */
const BUY_SIGNALS = /comprar|quero fechar|manda o link|como faço para adquirir/;
const PRICE_SIGNALS = /quanto custa|preço|valor|investimento|quanto é/;
const SUPPORT_SIGNALS = /reclama|problema|reembolso|cancelar|não funcionou/;

function leadQualification(message: string): unknown {
  if (SUPPORT_SIGNALS.test(message)) {
    return {
      temperature: 'COLD',
      score: 10,
      intent: '[EXEMPLO] atendimento, não compra',
      problem: null,
      productId: null,
      budget: null,
      urgency: null,
      decisionStage: 'pós-compra',
      funnelStage: 'RETENTION',
      objections: [],
      suggestedNextAction: 'Transferir para atendimento humano.',
      handoffToHuman: true,
      handoffReason: 'Mensagem parece reclamação ou pedido de reembolso.',
      confidence: 0.4,
    };
  }

  if (BUY_SIGNALS.test(message)) {
    return {
      temperature: 'READY',
      score: 90,
      intent: '[EXEMPLO] quer comprar agora',
      problem: null,
      productId: null,
      budget: null,
      urgency: '[EXEMPLO] imediata',
      decisionStage: 'decisão',
      funnelStage: 'DECISION',
      objections: [],
      suggestedNextAction: 'Enviar o link de compra cadastrado.',
      handoffToHuman: false,
      handoffReason: null,
      confidence: 0.5,
    };
  }

  if (PRICE_SIGNALS.test(message)) {
    return {
      temperature: 'WARM',
      score: 45,
      intent: '[EXEMPLO] quer saber preço',
      problem: null,
      productId: null,
      budget: null,
      urgency: null,
      decisionStage: 'comparação',
      funnelStage: 'CONSIDERATION',
      objections: ['[EXEMPLO] preocupação com preço'],
      suggestedNextAction: 'Entender o contexto antes de falar de valor.',
      handoffToHuman: false,
      handoffReason: null,
      confidence: 0.5,
    };
  }

  return {
    temperature: 'COLD',
    score: 15,
    intent: null,
    problem: null,
    productId: null,
    budget: null,
    urgency: null,
    decisionStage: 'descoberta',
    funnelStage: 'AWARENESS',
    objections: [],
    suggestedNextAction: 'Agradecer e fazer uma pergunta aberta.',
    handoffToHuman: false,
    handoffReason: null,
    confidence: 0.4,
  };
}

function salesReply(message: string): unknown {
  if (SUPPORT_SIGNALS.test(message)) {
    return {
      message:
        '[EXEMPLO] Sinto muito pelo transtorno. Vou chamar alguém do time para te ajudar com isso.',
      intent: 'atendimento',
      stage: 'SUPPORT',
      objectionsAddressed: [],
      shouldSendCheckout: false,
      productId: null,
      handoffToHuman: true,
      handoffReason: 'Reclamação: precisa de humano.',
      followUpReason: null,
      confidence: 0.4,
    };
  }

  if (BUY_SIGNALS.test(message)) {
    return {
      message:
        '[EXEMPLO] Que bom! Te mando o link para você finalizar quando quiser. Qualquer dúvida antes, é só falar.',
      intent: 'comprar',
      stage: 'CLOSING',
      objectionsAddressed: [],
      // O link vem do catálogo, não deste texto — o serviço resolve a URL.
      shouldSendCheckout: true,
      productId: null,
      handoffToHuman: false,
      handoffReason: null,
      followUpReason: 'Pediu o link e ainda não confirmou a compra.',
      confidence: 0.5,
    };
  }

  if (PRICE_SIGNALS.test(message)) {
    return {
      message:
        '[EXEMPLO] Te falo já sobre valores. Antes, me conta rapidinho: o que você está querendo resolver hoje?',
      intent: 'saber preço',
      stage: 'QUALIFYING',
      objectionsAddressed: [],
      shouldSendCheckout: false,
      productId: null,
      handoffToHuman: false,
      handoffReason: null,
      followUpReason: 'Perguntou preço e ainda não respondeu à qualificação.',
      confidence: 0.5,
    };
  }

  return {
    message:
      '[EXEMPLO] Obrigado por escrever! Me conta um pouco do que você precisa que eu te ajudo.',
    intent: 'contato inicial',
    stage: 'QUALIFYING',
    objectionsAddressed: [],
    shouldSendCheckout: false,
    productId: null,
    handoffToHuman: false,
    handoffReason: null,
    followUpReason: null,
    confidence: 0.4,
  };
}

function followUp(): unknown {
  return {
    shouldSend: true,
    message:
      '[EXEMPLO] Passando para deixar uma informação que pode ajudar na sua decisão. Quer que eu detalhe?',
    skipReason: null,
    isLastAttempt: false,
  };
}
