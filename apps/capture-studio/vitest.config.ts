import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'service/**/*.test.ts'],
    environment: 'jsdom',
    // service/** is plain Node code (the local Studio service) — it
    // never runs in a browser, so its tests run under Node, not jsdom.
    environmentMatchGlobs: [['service/**', 'node']],
    setupFiles: ['./src/setupTests.ts'],
  },
});
