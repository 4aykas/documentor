import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { renderPdf } from '../../src/render/pdf.js';
import { renderMarkdown } from '../../src/render/md.js';
import { loadTheme } from '../../src/theme/resolve.js';
import { pdfText } from '../helpers/pdf-text.js';
import { pdfRuns } from '../helpers/pdf-runs.js';
import { type Run, classify, expectSameSequence, norm, runsFromMarkdown } from './runs.js';

// The brief's plain `new URL('.', import.meta.url).pathname` strips the
// leading slash off a Windows drive path but leaves the rest of the
// pathname percent-encoded, so a checkout under a directory whose path
// contains a space resolves to a literal "%20" in the filesystem path and
// every read below fails with ENOENT. fileURLToPath decodes correctly on
// every platform.
const HERE = fileURLToPath(new URL('.', import.meta.url));
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

/**
 * The renderers still agree.
 *
 * Two renderers, one IR, and both are hand-written exhaustive switches over
 * `Block`. TypeScript forces each to *have* a case for every block type; it
 * cannot force the two cases to *mean the same thing* — a `list` that resumes
 * its numbering in one renderer and restarts it in the other type-checks
 * perfectly. So one document goes through both and the results are compared
 * the way a person would compare them: the same headings, the same numbers in
 * the same cells, the same words in the same order.
 *
 * Everything below compares extracted *content*, never markup: Markdown says
 * `**bold**` and a PDF says "bold" in a heavier face, and neither is wrong.
 *
 * Two differences are deliberate and excluded rather than reconciled:
 *   - an image is a picture in the PDF and a reference in Markdown, so a data:
 *     image contributes text to one and nothing to the other;
 *   - the PDF's running header (title, `N / M`) has no Markdown counterpart,
 *     and is stripped page by page below.
 */
describe('the renderers agree', () => {
  async function expectRenderersAgree(markdownSource: string): Promise<void> {
    const theme = await loadTheme('plain');
    const { doc } = ingestMarkdown(markdownSource);
    const buf = await renderPdf(doc, theme, { epochSeconds: EPOCH, browser });

    const md = runsFromMarkdown(renderMarkdown(doc));
    resetPdfjsWorkerGlobal();
    const pdf = (await pdfRuns(buf))
      .map((r) => ({ kind: classify(r.sizePt, theme), text: r.text }))
      .filter((r): r is Run => r.kind !== 'chrome');

    // Headings, in order, with their level — a heading demoted to body text in
    // one renderer and not the other lands here.
    const headings = (rs: Run[]) =>
      rs.filter((r) => r.kind.startsWith('heading')).map((r) => `h${r.kind.slice(-1)} ${r.text}`);
    expectSameSequence('heading', headings(md), headings(pdf));

    // Table cell values, in row-major order, compared word by word rather than
    // cell by cell. A PDF has no cell boundaries to read back — a wrapped cell
    // is just more text at the table's size — so the comparable thing is the
    // sequence of values, which is what catches a column swapped, a row
    // dropped or a number changed. Where the *boundaries* land is geometry,
    // and the baseline image already answers that.
    const cellWords = (rs: Run[]) => rs.filter((r) => r.kind === 'cell').map((r) => r.text).join(' ').split(' ').filter(Boolean);
    expectSameSequence('table word', cellWords(md), cellWords(pdf));

    // List numbering. This is exactly where `list.start` drift lands: a
    // fragment after a nested list resuming at 4 in one renderer and at 1 in
    // the other.
    // A marker is "digits, a dot, then a space" — which "4.50" is not, so a
    // decimal in the prose cannot be mistaken for an item number.
    const numbering = (rs: Run[]) =>
      rs.flatMap((r) =>
        r.kind === 'listItem' || r.kind === 'text'
          ? [...r.text.matchAll(/(?:^|\s)(\d+)\.(?=\s)/g)].map((m) => m[1]!)
          : [],
      );
    expectSameSequence('list number', numbering(md), numbering(pdf));

    // Finally the whole body text, whitespace-normalised, as one sequence of
    // words. A block type one renderer has learned and the other has not shows
    // up here as a run that only one side has.
    const pages = await pdfText(buf);
    const stripHeader = (page: string, i: number) => {
      // Built from what the header is supposed to say, so a header that stops
      // saying it fails here rather than being quietly tolerated.
      const chrome = `${doc.meta.title} ${i + 1} / ${pages.length}`;
      expect(page.endsWith(chrome), `page ${i + 1} does not end with its running header`).toBe(true);
      return page.slice(0, -chrome.length);
    };
    const pdfBody = norm(pages.map(stripHeader).join(' '));
    const mdBody = norm(md.map((r) => r.text).join(' '));
    expect(pdfBody, 'the two renderers put different words on the page').toBe(mdBody);
  }

  it('agrees on the kitchen-sink fixture, every block type at once', async () => {
    await expectRenderersAgree(source);
  });

  it('agrees on the numbering of an ordered list that a sublist interrupts', async () => {
    // The fixture has no split list, so on its own the numbering comparison
    // never sees a `start` other than 1 — and a check that would pass whatever
    // the renderers did is the one worth worrying about. This is the shape that
    // produces `start`: a nested list mid-list splits the parent into
    // fragments, and every fragment after the first has to remember where the
    // numbering had got to.
    await expectRenderersAgree('# Numbering\n\n1. First\n2. Second\n   - a nested aside\n3. Third\n4. Fourth\n');
  });
});
