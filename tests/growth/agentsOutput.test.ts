import { describe, expect, it } from 'vitest';
import { reconcileScore } from '@/server/growth/agents/leadQualifier';
import {
  validateSceneDurations,
  type VideoBriefOutput,
} from '@/server/growth/agents/videoCreator';
import { resolveCheckoutUrl } from '@/server/growth/agents/salesRep';
import type { ProductSummary } from '@/server/growth/types';

const products: ProductSummary[] = [
  {
    id: 'prod-1',
    name: 'Consultoria',
    description: 'Diagnóstico',
    priceCents: 49700,
    currency: 'BRL',
    checkoutUrl: 'https://pagamento.exemplo/checkout',
    schedulingUrl: null,
    benefits: [],
  },
  {
    id: 'prod-2',
    name: 'Mentoria',
    description: 'Acompanhamento',
    priceCents: null,
    currency: 'BRL',
    checkoutUrl: null,
    schedulingUrl: 'https://agenda.exemplo/mentoria',
    benefits: [],
  },
];

describe('reconciliação de score e temperatura', () => {
  it('traz o score para a faixa da temperatura', () => {
    expect(reconcileScore('READY', 40)).toBe(85);
    expect(reconcileScore('COLD', 90)).toBe(24);
  });

  it('mantém o score quando já está coerente', () => {
    expect(reconcileScore('WARM', 42)).toBe(42);
    expect(reconcileScore('HOT', 70)).toBe(70);
  });
});

describe('validação do briefing de vídeo', () => {
  function brief(scenes: number[], total: number): VideoBriefOutput {
    return {
      totalDurationSec: total,
      aspectRatio: '9:16',
      scenes: scenes.map((durationSec, index) => ({
        index: index + 1,
        durationSec,
        visualPrompt: 'cena',
        narration: 'fala',
        onScreenText: '',
        bRoll: 'nenhum',
      })),
      narrationScript: 'narração',
      captions: [],
      thumbnailPrompt: '',
      hashtags: [],
      musicMood: '',
    };
  }

  it('aceita pequena diferença de arredondamento', () => {
    expect(validateSceneDurations(brief([5, 5, 5, 15], 30)).ok).toBe(true);
  });

  it('acusa quando a soma das cenas não fecha com a duração', () => {
    const result = validateSceneDurations(brief([5, 5], 30));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/não corresponde/);
  });
});

describe('resolução do link de compra', () => {
  it('usa a URL do catálogo, não a que o modelo escreveu', () => {
    expect(resolveCheckoutUrl('prod-1', products)).toEqual({
      url: 'https://pagamento.exemplo/checkout',
      productId: 'prod-1',
    });
  });

  it('cai para o link de agendamento quando não há checkout', () => {
    expect(resolveCheckoutUrl('prod-2', products)?.url).toBe(
      'https://agenda.exemplo/mentoria',
    );
  });

  it('devolve null para produto inexistente ou ausente', () => {
    expect(resolveCheckoutUrl('prod-999', products)).toBeNull();
    expect(resolveCheckoutUrl(null, products)).toBeNull();
  });
});
