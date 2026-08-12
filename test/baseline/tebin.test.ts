import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { renderPdf } from '../../src/render/pdf.js';
import { buildHtml } from '../../src/render/html.js';
import { loadTheme } from '../../src/theme/resolve.js';
import { rasterPages } from '../helpers/raster.js';

// The brief's plain `new URL('.', import.meta.url).pathname` strips the
// leading slash off a Windows drive path but leaves the rest of the
// pathname percent-encoded, so a checkout under a directory whose path
// contains a space resolves to a literal "%20" in the filesystem path and
// every read below fails with ENOENT. fileURLToPath decodes correctly on
// every platform.
const HERE = fileURLToPath(new URL('.', import.meta.url));
const BASELINE = join(HERE, '__baseline__');
const ACTUAL = join(HERE, '__actual__');
const EPOCH = 1_000_000_000;

/**
 * `pdf-to-img` (used by rasterPages) bundles its own pdfjs-dist@4.2.67,
 * pinned independently of this project's pdfjs-dist@4.10.38 (used by
 * pdfText and below) — npm cannot dedupe across the version conflict, so
 * both copies load into the same process. In Node, pdfjs-dist has no real
 * worker thread; it falls back to a "fake worker" and caches its message
 * handler on `globalThis.pdfjsWorker`, keyed by nothing but insertion
 * order. Whichever copy resolves first wins that global permanently, so the
 * next *different* copy to run finds a handler tagged with the wrong
 * version and throws instead of loading its own. Clearing the slot right
 * before a copy's first use in this file lets it load fresh; after that,
 * pdfjs-dist memoizes the resolution per module, so later calls to the same
 * copy are unaffected by this reset.
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

describe('the TEBIN theme', () => {
  it('paints the logo by class, so the theme owns its colours', async () => {
    const theme = await loadTheme('tebin');
    const { doc } = ingestMarkdown(source);
    const html = await buildHtml(doc, theme);
    // The mark carries the classes and the stylesheet carries the rules; if
    // either half goes missing the logo prints solid black, which is SVG's
    // initial fill and reads at a glance as "the stylesheet did not load".
    expect(html).toContain('class="c-brand"');
    expect(html).toContain('.logo .c-brand{ fill: var(--brand); }');
    expect(html).toContain('--brand: #DA291C;');
  });

  it('prints the letterhead the entity actually uses', async () => {
    const theme = await loadTheme('tebin');
    const { doc } = ingestMarkdown(source);
    const html = await buildHtml(doc, theme);
    expect(html).toContain('TEBIN.PRO Sp. z o.o.');
    expect(html).toContain('NIP: 9552562516 | REGON: 521434962');
  });

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
