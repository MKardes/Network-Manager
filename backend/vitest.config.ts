import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration tests that need an OpenSSH/WireGuard fixture opt in via
    // RUN_INTEGRATION=1; otherwise they self-skip.
    testTimeout: 20_000,
  },
});
