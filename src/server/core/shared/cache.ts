import { createHash } from 'node:crypto';

/**
 * Cache de respostas de IA.
 *
 * A implementação em memória serve para testes e para o processo único do MVP.
 * A implementação em banco (tabela `ai_cache`) entra junto com a Etapa 3, sem
 * mudar quem consome a interface.
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt: number | null;
}

export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export class InMemoryCacheStore implements CacheStore {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlMs === undefined ? null : Date.now() + ttlMs,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/**
 * Chave determinística de cache.
 *
 * Inclui a versão do prompt: alterar o prompt invalida o cache automaticamente,
 * evitando servir resposta gerada por uma instrução antiga.
 */
export function buildCacheKey(parts: {
  operation: string;
  provider: string;
  model: string;
  promptVersion: string;
  /** Hash do conteúdo: sha256 da imagem, do CSV ou do texto de entrada. */
  inputHash: string;
}): string {
  const raw = [
    parts.operation,
    parts.provider,
    parts.model,
    parts.promptVersion,
    parts.inputHash,
  ].join('|');

  return createHash('sha256').update(raw).digest('hex');
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
