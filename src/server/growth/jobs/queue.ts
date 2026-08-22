import { prisma } from '@/server/db/prisma';
import { PrismaJobQueue } from './PrismaJobQueue';

/**
 * Instância única da fila.
 *
 * Os serviços enfileiram por aqui; os handlers são resolvidos em
 * `jobs/registry.ts`. A separação evita ciclo de importação: serviço → fila,
 * registry → handler → serviço.
 */
export const growthQueue = new PrismaJobQueue(prisma);
