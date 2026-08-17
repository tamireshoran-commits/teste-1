import { describe, expect, it, vi } from 'vitest';
import { runListingChecks } from '@/server/core/analysis/listing/checks';
import { computeListingScore } from '@/server/core/analysis/listing/listingScore';
import { ListingAnalysisService } from '@/server/core/analysis/listing/ListingAnalysisService';
import { MockLLMProvider } from '@/server/core/providers/ai/llm/MockLLMProvider';
import type { LLMProvider } from '@/server/core/providers/ai/llm/LLMProvider';
import {
  MockAirbnbProvider,
  MockBookingProvider,
} from '@/server/core/providers/listing/MockListingProvider';
import { InMemoryCacheStore } from '@/server/core/shared/cache';
import { ProviderError, RateLimitError } from '@/server/core/shared/errors';
import { NoopUsageRecorder } from '@/server/core/shared/usage';
import type { ListingData, Platform } from '@/server/core/types';

function listing(
  overrides: Partial<ListingData> = {},
  platform: Platform = 'AIRBNB',
): ListingData {
  return {
    platform,
    source: 'MANUAL',
    isMock: false,
    capturedAt: new Date().toISOString(),
    amenities: [],
    houseRules: [],
    photos: [],
    ...overrides,
  };
}

/** Anúncio bem preenchido, para servir de teto nas comparações. */
function strongListing(platform: Platform = 'AIRBNB'): ListingData {
  return listing(
    {
      title: 'Apartamento 2 quartos a 200m da praia com vista para o mar',
      description: 'x'.repeat(800),
      propertyType: 'Apartamento inteiro',
      bedrooms: 2,
      bathrooms: 2,
      beds: 3,
      maxGuests: 5,
      amenities: [
        'Wi-Fi', 'Cozinha', 'Roupa de cama', 'Toalhas', 'Ar-condicionado',
        'Máquina de lavar', 'TV', 'Estacionamento', 'Piscina', 'Churrasqueira',
        'Varanda',
      ],
      houseRules: ['Não fumar'],
      cancellationPolicy: 'Flexível',
      checkIn: '15:00',
      checkOut: '11:00',
      rating: platform === 'AIRBNB' ? 4.9 : 9.4,
      reviewCount: 150,
      photos: Array.from({ length: 20 }, (_u, i) => ({ position: i })),
      ...(platform === 'AIRBNB'
        ? { isSuperhost: true, instantBook: true }
        : { roomTypes: ['Apartamento 2 quartos'], breakfastIncluded: true }),
    },
    platform,
  );
}

const scoreOf = (l: ListingData, photoScore: number | null = null) =>
  computeListingScore({ listing: l, checks: runListingChecks(l), photoScore });

describe('computeListingScore — forma', () => {
  it('devolve score inteiro entre 0 e 100 nas duas plataformas', () => {
    for (const platform of ['AIRBNB', 'BOOKING'] as const) {
      const score = scoreOf(strongListing(platform));

      expect(Number.isInteger(score.score)).toBe(true);
      expect(score.score).toBeGreaterThanOrEqual(0);
      expect(score.score).toBeLessThanOrEqual(100);
    }
  });

  it('dá uma razão em texto para cada componente', () => {
    for (const component of scoreOf(strongListing()).components) {
      expect(component.reason.length).toBeGreaterThan(10);
    }
  });

  it('usa eixos diferentes por plataforma', () => {
    const airbnb = scoreOf(strongListing('AIRBNB')).components.map((c) => c.key);
    const booking = scoreOf(strongListing('BOOKING')).components.map((c) => c.key);

    expect(airbnb).toContain('presentation');
    expect(airbnb).not.toContain('policies');
    expect(booking).toContain('policies');
    expect(booking).not.toContain('presentation');
  });
});

describe('computeListingScore — sensibilidade', () => {
  it('pontua muito melhor um anúncio completo que um vazio', () => {
    expect(scoreOf(strongListing()).score).toBeGreaterThan(
      scoreOf(listing()).score + 40,
    );
  });

  it('usa o Photo Score quando disponível, em vez da contagem', () => {
    const base = strongListing();

    const comFotosBoas = scoreOf(base, 95);
    const comFotosRuins = scoreOf(base, 20);

    expect(comFotosBoas.score).toBeGreaterThan(comFotosRuins.score);

    const componente = comFotosBoas.components.find((c) => c.key === 'photos')!;
    expect(componente.reason).toContain('Photo Score');
  });

  it('avisa que só a quantidade foi avaliada quando não há Photo Score', () => {
    const componente = scoreOf(strongListing())
      .components.find((c) => c.key === 'photos')!;

    expect(componente.reason).toContain('quantidade');
    expect(componente.reason).toContain('não foi executada');
  });

  it('não deixa nota alta com poucas avaliações inflar a reputação', () => {
    // 5,0 com 2 avaliações não pode valer o mesmo que 4,8 com 300.
    const poucas = scoreOf(listing({ rating: 5, reviewCount: 2 }));
    const muitas = scoreOf(listing({ rating: 4.8, reviewCount: 300 }));

    const reputacao = (s: typeof poucas) =>
      s.components.find((c) => c.key === 'reputation')!.score!;

    expect(reputacao(muitas)).toBeGreaterThan(reputacao(poucas));
  });

  it('marca a reputação como indisponível sem nota nem avaliações', () => {
    const componente = scoreOf(listing()).components.find(
      (c) => c.key === 'reputation',
    )!;

    expect(componente.available).toBe(false);
    expect(componente.effectiveWeight).toBe(0);
  });

  it('penaliza política restritiva no Booking', () => {
    const flexivel = scoreOf(
      listing({ cancellationPolicy: 'Cancelamento gratuito' }, 'BOOKING'),
    );
    const rigida = scoreOf(
      listing({ cancellationPolicy: 'Não reembolsável' }, 'BOOKING'),
    );

    const politicas = (s: typeof flexivel) =>
      s.components.find((c) => c.key === 'policies')!.score!;

    expect(politicas(flexivel)).toBeGreaterThan(politicas(rigida));
  });

  it('a competitividade não afirma comparação com concorrentes reais', () => {
    // Não temos dados de concorrentes; o eixo mede desvio de boas práticas.
    const componente = scoreOf(listing()).components.find(
      (c) => c.key === 'competitiveness',
    )!;

    expect(componente.reason).toMatch(/não é comparação com concorrentes/i);
  });

  it('redistribui o peso dos componentes indisponíveis', () => {
    const total = scoreOf(listing()).components.reduce(
      (acc, c) => acc + c.effectiveWeight,
      0,
    );

    expect(total).toBeCloseTo(100);
  });
});

describe('ListingAnalysisService — sem IA', () => {
  it('entrega diagnóstico completo apenas com as regras', async () => {
    const service = new ListingAnalysisService();
    const data = await new MockAirbnbProvider().fetchListing({});

    const result = await service.analyze(data, { skipLlm: true });

    expect(result.platform).toBe('AIRBNB');
    expect(result.score.score).toBeGreaterThan(0);
    // A fixture preenche todos os campos base, então nada aparece como
    // ausente — mas a qualidade é fraca de propósito e gera problemas.
    expect(result.missingInfo).toEqual([]);
    expect(result.problems.map((p) => p.code)).toContain('DESCRIPTION_TOO_SHORT');
    expect(result.problems.map((p) => p.code)).toContain('FEW_PHOTOS');
    expect(result.differentiators).toEqual([]);
  });

  it('não chama a IA quando skipLlm está ligado', async () => {
    const llm: LLMProvider = {
      name: 'stub',
      isAvailable: vi.fn(async () => true),
      completeJSON: vi.fn(),
    };

    await new ListingAnalysisService({ llm }).analyze(listing(), {
      skipLlm: true,
    });

    expect(llm.completeJSON).not.toHaveBeenCalled();
  });
});

describe('ListingAnalysisService — enriquecimento por IA', () => {
  const respostaAirbnb = {
    scores: {
      content: 70, amenities: 65, reputation: 80,
      presentation: 60, competitiveness: 68,
    },
    strengths: ['Localização bem explorada no texto'],
    weaknesses: ['Título não comunica diferencial'],
    missing_info: ['Distância até a praia'],
    differentiators: ['Vista para o mar'],
    positioning: 'Econômico familiar',
    problems: [
      {
        code: 'GENERIC_TITLE',
        title: 'Título genérico',
        detail: 'O título não diferencia o imóvel dos concorrentes.',
        severity: 'HIGH',
      },
    ],
  };

  it('mescla o julgamento da IA com as regras', async () => {
    const llm = new MockLLMProvider().register('"platform": "AIRBNB"', respostaAirbnb);
    const service = new ListingAnalysisService({ llm });

    const result = await service.analyze(listing({ title: 'Casa' }));

    expect(result.positioning).toBe('Econômico familiar');
    expect(result.differentiators).toEqual(['Vista para o mar']);
    expect(result.strengths).toContain('Localização bem explorada no texto');
    expect(result.problems.some((p) => p.code === 'GENERIC_TITLE')).toBe(true);
    // As regras determinísticas continuam presentes.
    expect(result.problems.some((p) => p.code === 'TITLE_TOO_SHORT')).toBe(true);
  });

  it('marca a origem dos achados vindos do modelo', async () => {
    const llm = new MockLLMProvider().register('"platform": "AIRBNB"', respostaAirbnb);
    const result = await new ListingAnalysisService({ llm }).analyze(listing());

    const doLlm = result.problems.find((p) => p.code === 'GENERIC_TITLE')!;
    expect(doLlm.evidence).toMatchObject({ source: 'llm' });
  });

  it('entrega as regras mesmo quando a IA falha', async () => {
    const llm: LLMProvider = {
      name: 'stub',
      isAvailable: async () => true,
      completeJSON: async () => {
        throw new ProviderError('fora do ar');
      },
    };

    const result = await new ListingAnalysisService(
      { llm },
      undefined,
      { retries: 0 },
    ).analyze(listing({ title: 'Casa' }));

    // Diagnóstico parcial vale mais que erro na tela.
    expect(result.score.score).toBeGreaterThanOrEqual(0);
    expect(result.problems.some((p) => p.code === 'TITLE_TOO_SHORT')).toBe(true);
    expect(result.positioning).toBeUndefined();
  });

  it('entrega as regras quando a IA está indisponível', async () => {
    const llm: LLMProvider = {
      name: 'stub',
      isAvailable: async () => false,
      completeJSON: vi.fn(),
    };

    const result = await new ListingAnalysisService({ llm }).analyze(listing());

    expect(llm.completeJSON).not.toHaveBeenCalled();
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it('rejeita resposta fora do contrato sem contaminar o relatório', async () => {
    const llm = new MockLLMProvider().register('"platform": "AIRBNB"', {
      scores: { content: 'muito bom' },
      lixo: true,
    });

    const result = await new ListingAnalysisService(
      { llm },
      undefined,
      { retries: 0 },
    ).analyze(listing());

    expect(result.positioning).toBeUndefined();
    expect(result.differentiators).toEqual([]);
  });

  it('registra o uso, inclusive nas falhas', async () => {
    const recorder = new NoopUsageRecorder();

    const ok = new MockLLMProvider().register('"platform": "AIRBNB"', respostaAirbnb);
    await new ListingAnalysisService({ llm: ok, usageRecorder: recorder }).analyze(
      listing(),
      { analysisId: 'a1' },
    );

    const falha: LLMProvider = {
      name: 'stub',
      isAvailable: async () => true,
      completeJSON: async () => {
        throw new RateLimitError('stub');
      },
    };
    await new ListingAnalysisService(
      { llm: falha, usageRecorder: recorder },
      undefined,
      { retries: 0 },
    ).analyze(listing(), { analysisId: 'a1' });

    expect(recorder.entries).toHaveLength(2);
    expect(recorder.entries[0]).toMatchObject({
      analysisId: 'a1',
      operation: 'airbnb-analysis',
      success: true,
    });
    expect(recorder.entries[1]).toMatchObject({
      success: false,
      errorCode: 'RATE_LIMIT',
    });
  });

  it('reaproveita o cache para o mesmo anúncio', async () => {
    const cache = new InMemoryCacheStore();
    const llm = new MockLLMProvider().register('"platform": "AIRBNB"', respostaAirbnb);
    const spy = vi.spyOn(llm, 'completeJSON');

    const service = new ListingAnalysisService({ llm, cache });
    const data = listing({ title: 'Casa na praia com vista' });

    await service.analyze(data);
    await service.analyze(data);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('usa o prompt certo para cada plataforma', async () => {
    const respostaBooking = {
      scores: {
        content: 70, amenities: 65, reputation: 80,
        policies: 55, competitiveness: 68,
      },
      strengths: [],
      weaknesses: [],
      missing_info: [],
      recurring_positives: ['Localização'],
      recurring_negatives: ['Café da manhã'],
      problems: [],
    };

    const llm = new MockLLMProvider().register(
      '"platform": "BOOKING"',
      respostaBooking,
    );

    const data = await new MockBookingProvider().fetchListing({});
    const result = await new ListingAnalysisService({ llm }).analyze(data);

    expect(result.strengths).toContain('Localização');
    expect(result.weaknesses).toContain('Café da manhã');
  });

  it('descarta nomes de campo que a IA devolve no lugar de rótulos', async () => {
    // Regressão de um defeito visto na saída real: o modelo ecoava as chaves
    // do JSON recebido ("photoCaptions", "isSuperhost") e elas apareciam no
    // relatório do cliente no meio de rótulos em português.
    const llm = new MockLLMProvider().register('"platform": "AIRBNB"', {
      ...respostaAirbnb,
      missing_info: [
        'photoCaptions',
        'isSuperhost',
        'minimumStay',
        'Distância até a praia',
        'Regras sobre animais de estimação',
      ],
    });

    const result = await new ListingAnalysisService({ llm }).analyze(listing());

    expect(result.missingInfo).toContain('Distância até a praia');
    expect(result.missingInfo).toContain('Regras sobre animais de estimação');
    expect(result.missingInfo).not.toContain('photoCaptions');
    expect(result.missingInfo).not.toContain('isSuperhost');
    expect(result.missingInfo).not.toContain('minimumStay');
  });

  it('informa ao modelo o que as regras já detectaram', async () => {
    // Sem isso, o modelo reescreve os mesmos achados com outras palavras e o
    // mesmo problema ocupa duas linhas da lista de prioridades.
    const llm: LLMProvider = {
      name: 'stub',
      isAvailable: async () => true,
      completeJSON: vi.fn(async ({ parse }) => ({
        data: parse(respostaAirbnb),
        usage: { inputTokens: 1, outputTokens: 1 },
        model: 'stub',
      })),
    };

    await new ListingAnalysisService({ llm }).analyze(
      listing({ title: 'Casa' }),
    );

    const prompt = (llm.completeJSON as ReturnType<typeof vi.fn>).mock
      .calls[0]![0].prompt as string;

    expect(prompt).toContain('Título curto demais');
    expect(prompt).toContain('Não repita nada dessa lista');
  });

  it('o MockLLMProvider falha em vez de inventar conteúdo', async () => {
    // Um mock que improvisa esconderia bugs e vazaria texto fictício.
    const llm = new MockLLMProvider();

    await expect(
      llm.completeJSON({ prompt: 'qualquer', parse: (r) => r }),
    ).rejects.toThrow(/não inventa/);
  });
});
