import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Os testes de `tests/integration` batem em APIs de verdade e consomem
    // cota. Ficam fora do `npm test` e rodam sob demanda com `npm run test:live`.
    exclude: ['node_modules/**', 'tests/integration/**'],
    globals: false,
    // Carrega o .env para que os testes de integração enxerguem GEMINI_API_KEY.
    setupFiles: ['dotenv/config'],
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
});
