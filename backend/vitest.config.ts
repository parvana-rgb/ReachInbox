import { defineConfig } from 'vitest/config';

// Tests run against REAL Redis + PostgreSQL (see README -> Testing). They use an isolated
// database, Redis DB index and BullMQ prefix so they never touch dev data.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    setupFiles: ['tests/setupEnv.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
