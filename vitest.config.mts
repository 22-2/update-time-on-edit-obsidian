import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL('./test/obsidian.ts', import.meta.url)),
    },
  },
});
