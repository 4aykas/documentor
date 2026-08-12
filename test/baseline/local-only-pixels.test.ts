import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { renderPdf } from '../../src/render/pdf.js';
import { loadTheme } from '../../src/theme/resolve.js';
import { rasterPages } from '../helpers/raster.js';

// Everything in this file is a byte comparison of a rasterised PNG against a
// committed baseline, and none of it runs in CI. A PNG produced from the
// same PDF differs across platforms and even across Chromium builds on the
// same platform — CI's first real run proved this: the pages it rendered on
// windows-latest were visually identical to the committed baselines (same
// layout, same embedded Arimo, same Cyrillic and Polish glyphs) and still
// failed a byte comparison against images approved on this machine. A
// tolerant pixel-diff threshold was considered and rejected — the design
// says not to byte-compare rasterised output, and a fuzzy version of the
// same check just moves the false-positive rate instead of removing it. A
// check that cries wolf stops being read.
//
// So these images are a local, human-approved instrument: run them here,
// look at the result yourself, and commit the baseline once you agree it's
// right. They are deliberately kept in their own file, separate from
// kitchen-sink.test.ts and tebin.test.ts, so that the checks in those two
// files that are NOT rasterisation-dependent — the running header not
// colliding with the body, the fixture spanning more than one page, ingest
// dropping nothing, the Markdown round trip, the TEBIN theme's markup
// assertions — keep running in CI on all three platforms.
const HERE = fileURLToPath(new URL('.', import.meta.url));
const BASELINE = join(HERE, '__baseline__');
const ACTUAL = join(HERE, '__actual__');
const EPOCH = 1_000_000_000;

/**
 * `pdf-to-img` (used by rasterPages) bundles its own pdfjs-dist@4.2.67,
 * pinned independently of this project's pdfjs-dist@4.10.38 — npm cannot
 * dedupe across the version conflict, so both copies load into the same
 * process. In Node, pdfjs-dist has no real worker thread; it falls back to
 * a "fake worker" and caches its message handler on `globalThis.pdfjsWorker`,
 * keyed by nothing but insertion order. Whichever copy resolves first wins
 * that global permanently, so the next *different* copy to run finds a
 * handler tagged with the wrong version and throws instead of loading its
 * own. Clearing the slot right before a copy's first use in this file lets
 * it load fresh; after that, pdfjs-dist memoizes the resolution per module,
 * so later calls to the same copy are unaffected by this reset.
 */
function resetPdfjsWorkerGlobal(): void {
  delete (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker;
}

let browser: Browser;
let source: string;
beforeAll(async () => {
  browser = await chromium.launch();
  source = await readFile(join(HERE, '..', 'fixtures', 'kitchen-sink.md'), 'utf8');
});
afterAll(async () => { await browser.close(); });

describe('kitchen sink baseline (local pixels only)', () => {
  it('every page matches its committed image', async () => {
    const theme = await loadTheme('plain');
    const { doc } = ingestMarkdown(source);
    resetPdfjsWorkerGlobal();
    const pages = await rasterPages(await renderPdf(doc, theme, { epochSeconds: EPOCH, browser }));

    await mkdir(ACTUAL, { recursive: true });
    for (const [i, png] of pages.entries()) {
      const name = `page-${String(i + 1).padStart(2, '0')}.png`;
      await writeFile(join(ACTUAL, name), png);
      const golden = join(BASELINE, name);
      expect(existsSync(golden), `no baseline for ${name} — review test/baseline/__actual__/${name} and copy it into __baseline__ if it is correct`).toBe(true);
      expect(png.equals(await readFile(golden)), `${name} differs from its baseline; compare it with test/baseline/__actual__/${name}`).toBe(true);
    }
  });
});

describe('the TEBIN theme (local pixels only)', () => {
  it('page one matches its committed image', async () => {
    const theme = await loadTheme('tebin');
    const { doc } = ingestMarkdown(source);
    resetPdfjsWorkerGlobal();
    const pages = await rasterPages(await renderPdf(doc, theme, { epochSeconds: EPOCH, browser }));
    await mkdir(ACTUAL, { recursive: true });
    await writeFile(join(ACTUAL, 'tebin-page-01.png'), pages[0]!);
    const golden = join(BASELINE, 'tebin-page-01.png');
    expect(existsSync(golden), 'no baseline yet — review test/baseline/__actual__/tebin-page-01.png and copy it into __baseline__ if it is correct').toBe(true);
    expect(pages[0]!.equals(await readFile(golden))).toBe(true);
  });
});
