import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Browser scenarios run through Playwright (`bun run test:e2e`), not Vitest.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
