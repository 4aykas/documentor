import { defineConfig } from 'vitest/config';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // OneDrive holds file handles while it syncs and breaks Vite's atomic
  // directory renames, corrupting the dep cache. Keep it out of the synced tree.
  cacheDir: join(tmpdir(), 'documentor-vite-cache'),
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000, // launching Chromium and rasterising is not fast
    // The suite's own themes (dark-sheet, …) are found by id the way a
    // user's are: through DOCUMENTOR_THEMES (ADR 0011).
    env: { DOCUMENTOR_THEMES: fileURLToPath(new URL('./test/fixtures/themes', import.meta.url)) },
  },
});
