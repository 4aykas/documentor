import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { renderPdf } from '../../src/render/pdf.js';
import { renderMarkdown } from '../../src/render/md.js';
import { loadTheme } from '../../src/theme/resolve.js';
import { pdfText } from '../helpers/pdf-text.js';
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

describe('kitchen sink baseline', () => {
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

  it('renders the fixture in more than one page', async () => {
    const theme = await loadTheme('plain');
    const { doc } = ingestMarkdown(source);
    resetPdfjsWorkerGlobal();
    const pages = await pdfText(await renderPdf(doc, theme, { epochSeconds: EPOCH, browser }));
    expect(pages.length).toBeGreaterThan(1);
  });

  it('the running header does not collide with the body', async () => {
    // The collision is invisible to text extraction, so this asserts on the
    // geometry instead: no glyph may sit above the top margin.
    const theme = await loadTheme('plain');
    const { doc } = ingestMarkdown(source);
    const buf = await renderPdf(doc, theme, { epochSeconds: EPOCH, browser });
    resetPdfjsWorkerGlobal();
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfDoc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
    const page = await pdfDoc.getPage(1);
    const height = page.getViewport({ scale: 1 }).height;
    const items = (await page.getTextContent()).items.filter((it) => 'str' in it && it.str.trim() !== '');
    // Header baseline sits inside the top margin; body text must start below it.
    const headerBand = height - theme.page.marginPt;
    // The running header itself legitimately sits in this band — Chromium bakes
    // its header template straight into the page content stream, so pdfjs
    // reports its two pieces (the repeated title, and the "N / M" page
    // counter) as ordinary text items indistinguishable from body text except
    // by position. Both must be excluded, or this test would flag the header
    // for colliding with itself.
    //
    // The title piece can't be matched with a plain `startsWith`: Chromium's
    // @font-face unicode-range subsetting (see pdf-text.ts) switches fonts
    // mid-title for a mixed-script string like "Kitchen Sink — Зразок —
    // Wzorzec", so pdfjs splits it into several items, and only the first of
    // those is a *prefix* of the title — the rest, like "Зразок" on its own,
    // are fragments from the middle. `includes` matches any of them.
    //
    // The counter pattern must match only "N / M" — not any bare number —
    // or it would also exclude the fixture's own Quantity column ("12",
    // "3", "140") from the check, blinding this test to exactly the kind
    // of stray body content (a table row stranded at the top of a page)
    // it exists to catch.
    const isHeaderText = (s: string) => doc.meta.title.includes(s) || /^\d+\s*\/\s*\d+$/.test(s);
    const bodyItems = items.filter((it) => 'str' in it && !isHeaderText(it.str.trim()));
    for (const it of bodyItems) {
      const y = (it as { transform: number[] }).transform[5]!;
      expect(y, `a glyph sits inside the top margin: ${(it as { str: string }).str}`).toBeLessThan(headerBand);
    }
  });

  it('drops nothing from the fixture', async () => {
    expect(ingestMarkdown(source).dropped).toEqual([]);
  });

  it('round-trips through Markdown unchanged', async () => {
    const once = renderMarkdown(ingestMarkdown(source).doc);
    expect(renderMarkdown(ingestMarkdown(once).doc)).toBe(once);
  });
});
