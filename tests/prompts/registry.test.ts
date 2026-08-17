import { describe, expect, it } from 'vitest';
import {
  ACTIVE_PROMPT_VERSIONS,
  getPrompt,
  type PromptName,
} from '@/server/core/prompts/registry';

const ALL_PROMPTS = Object.keys(ACTIVE_PROMPT_VERSIONS) as PromptName[];

/** Variáveis exigidas por cada template, para o teste conseguir renderizar. */
const VARIABLES: Record<PromptName, Record<string, string>> = {
  'photo-analysis': {
    propertyType: 'apartamento',
    bedrooms: '2',
    city: 'Florianópolis',
    position: '0',
  },
  'airbnb-analysis': {
    listingJson: '{}',
    alreadyFlaggedJson: '[]',
    alreadyMissingJson: '[]',
  },
  'booking-analysis': {
    listingJson: '{}',
    alreadyFlaggedJson: '[]',
    alreadyMissingJson: '[]',
  },
  'pricing-analysis': { metricsJson: '{}', problemsJson: '[]' },
  recommendations: {
    scoresJson: '{}',
    photoFindingsJson: '[]',
    pricingFindingsJson: '[]',
    listingFindingsJson: '[]',
  },
};

describe('registry de prompts', () => {
  it('carrega todos os prompts declarados como ativos', () => {
    for (const name of ALL_PROMPTS) {
      const prompt = getPrompt(name, VARIABLES[name]);

      expect(prompt.name).toBe(name);
      expect(prompt.version).toBe(ACTIVE_PROMPT_VERSIONS[name]);
      expect(prompt.text.length).toBeGreaterThan(100);
    }
  });

  it('interpola as variáveis no template', () => {
    const prompt = getPrompt('photo-analysis', VARIABLES['photo-analysis']);

    expect(prompt.text).toContain('Florianópolis');
    expect(prompt.text).not.toContain('{{city}}');
  });

  it('falha quando falta uma variável, em vez de mandar {{var}} para o modelo', () => {
    expect(() => getPrompt('photo-analysis', { city: 'Rio' })).toThrow(
      /Variáveis ausentes/,
    );
  });

  it('falha para prompt inexistente', () => {
    expect(() => getPrompt('photo-analysis', {}, 'v999')).toThrow(
      /Prompt não encontrado/,
    );
  });

  it('nenhum prompt deixa placeholder por preencher após a interpolação', () => {
    for (const name of ALL_PROMPTS) {
      const prompt = getPrompt(name, VARIABLES[name]);
      expect(prompt.text).not.toMatch(/\{\{\w+\}\}/);
    }
  });

  it('todos os prompts proíbem promessa de receita', () => {
    // Regra de produto: nenhum prompt pode autorizar linguagem de garantia.
    for (const name of ALL_PROMPTS) {
      const text = getPrompt(name, VARIABLES[name]).text.toLowerCase();
      const proibeGarantia =
        text.includes('não prometa') ||
        text.includes('nunca prometa') ||
        text.includes('linguagem de hipótese');

      expect(proibeGarantia, `prompt "${name}" precisa proibir promessas`).toBe(
        true,
      );
    }
  });

  it('os prompts que recebem dados proíbem invenção de dados', () => {
    for (const name of ALL_PROMPTS) {
      const text = getPrompt(name, VARIABLES[name]).text.toLowerCase();
      const proibeInvencao =
        text.includes('não invente') ||
        text.includes('nunca invente') ||
        text.includes('não presuma') ||
        text.includes('não deduza') ||
        text.includes('apenas com os dados') ||
        text.includes('somente os dados') ||
        text.includes('apenas o que está visível');

      expect(proibeInvencao, `prompt "${name}" precisa proibir invenção`).toBe(
        true,
      );
    }
  });
});
