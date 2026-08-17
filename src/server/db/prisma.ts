import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { env } from '@/server/config/env';

/**
 * Prisma 7 exige um driver adapter explícito para providers SQL.
 *
 * Em desenvolvimento o hot-reload do Next recria os módulos a cada alteração;
 * sem o cache no globalThis isso abriria um pool novo a cada reload até
 * esgotar as conexões do Postgres.
 */
const createPrismaClient = () => {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
};

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export type Db = typeof prisma;
