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
import { pdfRuns } from '../helpers/pdf-runs.js';
import { rasterPages } from '../helpers/raster.js';
import type { Theme } from '../../src/theme/types.js';

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
  // Content lifted out of one renderer's output, in reading order. `kind` is
  // only used to route it into the right comparison.
  type Run = { kind: 'heading1' | 'heading2' | 'heading3' | 'listItem' | 'cell' | 'text'; text: string };

  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

  /** Markdown markup → the words a reader sees. Order matters: links first. */
  function unmark(s: string): string {
    return s
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\\\|/g, '|');
  }

  /** What the Markdown renderer put on the page. */
  function runsFromMarkdown(md: string): Run[] {
    const runs: Run[] = [];
    const lines = md.split('\n');
    let para: string[] = [];
    const flushPara = () => {
      if (para.length) runs.push({ kind: 'text', text: norm(unmark(para.join(' '))) });
      para = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const fence = line.match(/^(`{3,})/);
      if (fence) {
        flushPara();
        const code: string[] = [];
        for (i++; i < lines.length && !lines[i]!.startsWith(fence[1]!); i++) code.push(lines[i]!);
        // Code is never unmarked: its backticks and asterisks are its content.
        runs.push({ kind: 'text', text: norm(code.join(' ')) });
        continue;
      }
      if (line.trim() === '') { flushPara(); continue; }
      const heading = line.match(/^(#{1,3}) (.*)$/);
      if (heading) {
        flushPara();
        runs.push({ kind: `heading${heading[1]!.length}` as Run['kind'], text: norm(unmark(heading[2]!)) });
        continue;
      }
      const ordered = line.match(/^\s*(\d+)\. (.*)$/);
      if (ordered) {
        flushPara();
        // The marker is part of the run: it is what a reader compares when
        // they check that item 4 is not numbered 1 again.
        runs.push({ kind: 'listItem', text: `${ordered[1]}. ${norm(unmark(ordered[2]!))}` });
        continue;
      }
      const bullet = line.match(/^\s*- (.*)$/);
      if (bullet) {
        flushPara();
        // A bullet glyph is drawn, not typed, so the PDF has no text for it.
        runs.push({ kind: 'listItem', text: norm(unmark(bullet[1]!)) });
        continue;
      }
      if (line.startsWith('>')) {
        flushPara();
        const quoted = norm(unmark(line.replace(/^>\s?/, '')));
        if (quoted !== '') runs.push({ kind: 'text', text: quoted });
        continue;
      }
      if (line.startsWith('|')) {
        flushPara();
        const cells = line.slice(1, line.replace(/\s+$/, '').length - 1).split(/(?<!\\)\|/);
        // The alignment row is syntax, not content.
        if (cells.every((c) => /^\s*:?-+:?\s*$/.test(c))) continue;
        for (const c of cells) runs.push({ kind: 'cell', text: norm(unmark(c)) });
        continue;
      }
      // A horizontal rule, an image and the pagebreak comment all draw
      // something a reader sees but say nothing a reader reads.
      if (/^-{3,}$/.test(line.trim()) || line.startsWith('![') || line.startsWith('<!--')) {
        flushPara();
        continue;
      }
      para.push(line);
    }
    flushPara();
    return runs.filter((r) => r.text !== '');
  }

  /**
   * What the PDF renderer put on the page. An untagged PDF has no block types,
   * so the classification is by type size — which is exactly the evidence a
   * reader uses. It is coupled to the stylesheet's sizes on purpose: if a
   * renderer stops setting headings larger than body text, that is the bug.
   */
  function classify(sizePt: number, theme: Theme): Run['kind'] | 'chrome' {
    const near = (a: number, b: number) => Math.abs(a - b) < 0.3;
    if (near(sizePt, theme.type.smallPt - 1)) return 'chrome'; // the running header
    if (near(sizePt, theme.type.h1Pt)) return 'heading1';
    if (near(sizePt, theme.type.h2Pt)) return 'heading2';
    if (near(sizePt, theme.type.h3Pt)) return 'heading3';
    if (near(sizePt, theme.type.bodyPt * 0.95)) return 'cell';
    return 'text';
  }

  /**
   * A sequence comparison that says what went wrong. `toEqual` on two long
   * arrays prints both and leaves the reader to diff them by eye, which is
   * exactly the moment a failing test stops being read.
   */
  function expectSameSequence(what: string, fromMd: string[], fromPdf: string[]): void {
    for (let i = 0; i < Math.max(fromMd.length, fromPdf.length); i++) {
      if (fromMd[i] === fromPdf[i]) continue;
      const detail =
        fromPdf[i] === undefined
          ? `the PDF renderer is missing ${what} #${i + 1}: ${JSON.stringify(fromMd[i])}`
          : fromMd[i] === undefined
            ? `the Markdown renderer is missing ${what} #${i + 1}: ${JSON.stringify(fromPdf[i])}`
            : `${what} #${i + 1} differs — Markdown: ${JSON.stringify(fromMd[i])} · PDF: ${JSON.stringify(fromPdf[i])}`;
      expect.fail(`the renderers disagree: ${detail}`);
    }
  }

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
