import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Configuração dos testes de integração.
 *
 * Estes testes chamam APIs de verdade e consomem cota, por isso ficam fora do
 * `npm test`. Rode sob demanda com `npm run test:live`. Sem as credenciais no
 * ambiente, cada suíte se pula sozinha em vez de falhar.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globals: false,
    setupFiles: ['dotenv/config'],
    // Chamadas de rede reais são lentas; um teste por vez evita rate limit.
    fileParallelism: false,
    testTimeout: 120_000,
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
});
