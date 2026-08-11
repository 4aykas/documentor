import { defineConfig } from 'vitest/config';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  // OneDrive holds file handles while it syncs and breaks Vite's atomic
  // directory renames, corrupting the dep cache. Keep it out of the synced tree.
  cacheDir: join(tmpdir(), 'documentor-vite-cache'),
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000, // launching Chromium and rasterising is not fast
  },
});
