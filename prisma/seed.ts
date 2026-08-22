import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { DEFAULT_SCORING_CONFIG } from '../src/server/core/analysis/scoring/config.js';

/**
 * Seed de desenvolvimento.
 *
 * Cria a configuração de scoring ativa e um usuário de teste. Não cria
 * análises fictícias: dado inventado no banco vira dado inventado no relatório.
 */

const connectionString = process.env['DATABASE_URL'];

if (!connectionString) {
  throw new Error('DATABASE_URL não configurada. Copie .env.example para .env.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  // ScoringWeights é uma interface fechada e o Prisma exige InputJsonValue
  // (que pede index signature). Serializamos para atravessar essa fronteira.
  const weights = JSON.parse(
    JSON.stringify(DEFAULT_SCORING_CONFIG.weights),
  ) as Prisma.InputJsonValue;

  const config = await prisma.scoreConfig.upsert({
    where: { version: DEFAULT_SCORING_CONFIG.version },
    update: { weights, isActive: true },
    create: {
      version: DEFAULT_SCORING_CONFIG.version,
      weights,
      isActive: true,
      notes: 'Configuração inicial de pesos do MVP.',
    },
  });

  console.log(`ScoreConfig "${config.version}" pronta.`);

  // Usuário de desenvolvimento apenas fora de produção.
  if (process.env['NODE_ENV'] !== 'production') {
    const email = 'dev@stayscore.local';

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        name: 'Usuário de Desenvolvimento',
        passwordHash: await bcrypt.hash('stayscore123', 12),
      },
    });

    console.log(`Usuário de desenvolvimento: ${user.email} / stayscore123`);

    await seedGrowthWorkspace(user.id);
  }
}

/**
 * Workspace de desenvolvimento do Growth Engine.
 *
 * Cria só a estrutura: workspace em modo manual, marca, um produto e uma conta
 * simulada. **Não cria conteúdo, lead nem venda fictícios** — dado inventado no
 * banco vira número inventado no painel e no módulo de aprendizado.
 */
async function seedGrowthWorkspace(userId: string) {
  const slug = 'workspace-dev';

  const workspace = await prisma.workspace.upsert({
    where: { slug },
    update: {},
    create: {
      ownerId: userId,
      name: 'Workspace de Desenvolvimento',
      slug,
      mode: 'MANUAL',
      members: { create: { userId, role: 'OWNER' } },
      brandProfile: {
        create: {
          name: 'Marca de Desenvolvimento',
          description: 'Workspace de testes do Growth Engine.',
          toneOfVoice: 'Direto, próximo e sem jargão.',
          doNotSay: ['garantia de resultado', 'fórmula secreta'],
        },
      },
    },
  });

  const productCount = await prisma.product.count({
    where: { workspaceId: workspace.id },
  });

  if (productCount === 0) {
    await prisma.product.create({
      data: {
        workspaceId: workspace.id,
        name: 'Consultoria inicial',
        description:
          'Diagnóstico de uma hora com plano de ação escrito, entregue em 48h.',
        priceCents: 49700,
        checkoutUrl: 'https://example.invalid/checkout/consultoria',
        benefits: ['Diagnóstico gravado', 'Plano de ação escrito'],
      },
    });
  }

  await prisma.socialAccount.upsert({
    where: {
      workspaceId_platform_externalId: {
        workspaceId: workspace.id,
        platform: 'INSTAGRAM',
        externalId: 'ig-dev-0001',
      },
    },
    update: {},
    create: {
      workspaceId: workspace.id,
      platform: 'INSTAGRAM',
      externalId: 'ig-dev-0001',
      username: 'conta.simulada',
      status: 'MOCK',
    },
  });

  console.log(`Workspace do Growth Engine pronto: ${workspace.slug} (modo manual)`);
}

main()
  .catch((error: unknown) => {
    console.error('Falha no seed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
