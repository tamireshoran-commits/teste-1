import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '@/server/core/shared/errors';

/**
 * Registro central de prompts.
 *
 * Nenhum prompt vive solto no código: todos ficam em `prompts/<função>/<versão>.md`
 * e são referenciados por nome + versão. Isso permite versionar instruções,
 * comparar resultados entre versões e invalidar cache automaticamente quando
 * um prompt muda (a versão entra na chave de cache).
 */

export type PromptName =
  | 'photo-analysis'
  | 'airbnb-analysis'
  | 'booking-analysis'
  | 'pricing-analysis'
  | 'recommendations'
  // Growth Engine — um prompt por agente, versionado igual aos demais.
  | 'growth/market-strategy'
  | 'growth/content-plan'
  | 'growth/video-brief'
  | 'growth/lead-qualification'
  | 'growth/sales-reply'
  | 'growth/follow-up'
  | 'growth/learning-insights';

/** Versão ativa de cada prompt. Subir aqui invalida o cache daquela função. */
export const ACTIVE_PROMPT_VERSIONS: Record<PromptName, string> = {
  'photo-analysis': 'v1',
  // v2: informa ao modelo o que as regras determinísticas já detectaram, para
  // ele não duplicar achados nem devolver nomes de campo no lugar de rótulos.
  'airbnb-analysis': 'v2',
  'booking-analysis': 'v2',
  'pricing-analysis': 'v1',
  'recommendations': 'v1',
  'growth/market-strategy': 'v1',
  'growth/content-plan': 'v1',
  'growth/video-brief': 'v1',
  'growth/lead-qualification': 'v1',
  'growth/sales-reply': 'v1',
  'growth/follow-up': 'v1',
  'growth/learning-insights': 'v1',
};

const PROMPTS_DIR = join(process.cwd(), 'prompts');

const cache = new Map<string, string>();

export interface ResolvedPrompt {
  name: PromptName;
  version: string;
  text: string;
}

function loadTemplate(name: PromptName, version: string): string {
  const cacheKey = `${name}/${version}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const path = join(PROMPTS_DIR, name, `${version}.md`);

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new AppError(`Prompt não encontrado: ${cacheKey}`, {
      code: 'NOT_FOUND',
      context: { name, version, path },
      cause,
    });
  }

  cache.set(cacheKey, text);
  return text;
}

/**
 * Carrega um prompt e interpola as variáveis `{{chave}}`.
 *
 * Lança se o template pedir uma variável não fornecida — melhor falhar no
 * desenvolvimento do que enviar `{{city}}` literal para o modelo.
 */
export function getPrompt(
  name: PromptName,
  variables: Record<string, string | number | undefined> = {},
  version = ACTIVE_PROMPT_VERSIONS[name],
): ResolvedPrompt {
  const template = loadTemplate(name, version);
  const missing: string[] = [];

  const text = template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = variables[key];

    if (value === undefined) {
      missing.push(key);
      return '';
    }

    return String(value);
  });

  if (missing.length > 0) {
    throw new AppError(
      `Variáveis ausentes no prompt "${name}/${version}": ${missing.join(', ')}`,
      { code: 'VALIDATION_ERROR', context: { name, version, missing } },
    );
  }

  return { name, version, text };
}

/** Limpa o cache de templates — usado em testes. */
export function clearPromptCache(): void {
  cache.clear();
}
