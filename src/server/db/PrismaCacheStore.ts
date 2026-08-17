import type { CacheStore } from '@/server/core/shared/cache';
import { logger } from '@/server/core/shared/logger';
import type { Db } from './prisma';

const log = logger.child('ai-cache');

/**
 * Só o delegate que usamos, em vez do `PrismaClient` inteiro.
 *
 * O tipo completo carrega o parâmetro de log na assinatura, o que faria um
 * client construído com outras opções (em testes, por exemplo) ser rejeitado
 * por um detalhe irrelevante para esta classe.
 */
export type CacheDb = Pick<Db, 'aICache'>;

/**
 * Cache de respostas de IA persistido na tabela `ai_cache`.
 *
 * Reanalisar a mesma foto (mesmo sha256, mesmo modelo, mesma versão de prompt)
 * é o caso mais comum de desperdício: o usuário reenvia o álbum inteiro depois
 * de trocar duas imagens. Com cache, só as novas custam.
 *
 * Falha de cache **nunca** derruba a análise: um cache indisponível degrada
 * para "sempre chama a API", que é caro mas correto.
 */
export class PrismaCacheStore implements CacheStore {
  constructor(
    private readonly db: CacheDb,
    private readonly meta: { provider: string; model: string; operation: string },
  ) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const entry = await this.db.aICache.findUnique({ where: { cacheKey: key } });

      if (!entry) return null;

      if (entry.expiresAt !== null && entry.expiresAt <= new Date()) {
        await this.delete(key);
        return null;
      }

      // Contabiliza o acerto sem bloquear a leitura.
      void this.db.aICache
        .update({ where: { cacheKey: key }, data: { hits: { increment: 1 } } })
        .catch(() => undefined);

      return entry.response as T;
    } catch (error) {
      log.warn('falha ao ler o cache; seguindo sem ele', { error });
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const expiresAt =
      ttlMs === undefined ? null : new Date(Date.now() + ttlMs);

    const response = JSON.parse(JSON.stringify(value)) as object;

    try {
      await this.db.aICache.upsert({
        where: { cacheKey: key },
        update: { response, expiresAt },
        create: {
          cacheKey: key,
          provider: this.meta.provider,
          model: this.meta.model,
          operation: this.meta.operation,
          response,
          expiresAt,
        },
      });
    } catch (error) {
      log.warn('falha ao gravar no cache; resultado não será reaproveitado', {
        error,
      });
    }
  }

  async delete(key: string): Promise<void> {
    await this.db.aICache.deleteMany({ where: { cacheKey: key } });
  }

  async clear(): Promise<void> {
    await this.db.aICache.deleteMany({});
  }
}
