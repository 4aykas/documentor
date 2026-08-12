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
import { renderDocx } from '../../src/render/docx.js';
import { docxPart } from '../helpers/docx-parts.js';
import type { Block, Doc } from '../../src/ir/types.js';
import {
  type Run, classify, expectSameSequence, norm, runsFromMarkdown,
  alignFromDocx, boldRunsFromDocx, cellsFromDocx, docTitleFromDocx, emphasisFromIr, flattenInline, headingsFromDocx,
  italicRunsFromDocx, linkTargetsFromIr, linkTargetsFromRels,
} from './runs.js';

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
    expectSameSequence('heading', { label: 'Markdown', items: headings(md) }, { label: 'PDF', items: headings(pdf) });

    // Table cell values, in row-major order, compared word by word rather than
    // cell by cell. A PDF has no cell boundaries to read back — a wrapped cell
    // is just more text at the table's size — so the comparable thing is the
    // sequence of values, which is what catches a column swapped, a row
    // dropped or a number changed. Where the *boundaries* land is geometry,
    // and the baseline image already answers that.
    const cellWords = (rs: Run[]) => rs.filter((r) => r.kind === 'cell').map((r) => r.text).join(' ').split(' ').filter(Boolean);
    expectSameSequence('table word', { label: 'Markdown', items: cellWords(md) }, { label: 'PDF', items: cellWords(pdf) });

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
    expectSameSequence('list number', { label: 'Markdown', items: numbering(md) }, { label: 'PDF', items: numbering(pdf) });

    // Finally the whole body text, whitespace-normalised, as one sequence of
    // words. A block type one renderer has learned and the other has not shows
    // up here as a run that only one side has.
    const pages = await pdfText(buf);
    const stripHeader = (page: string, i: number) => {
      // Page one is stitched in from the empty-header render (see pdf.ts) —
      // it carries no running-header chrome at all, on purpose, which is the
      // whole point of this change. Every later page still gets the chrome
      // the running header always printed, built from what it is supposed to
      // say, so a header that stops saying it fails here rather than being
      // quietly tolerated.
      if (i === 0) return page;
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

describe('Word says what the others say', () => {
  it('carries every heading, in order and at its level', async () => {
    // Compared against the IR, not against Markdown, and for the same reason
    // emphasis and link targets are: `ingestMarkdown` lifts the document's
    // first `h1` out of `blocks` entirely into `meta.title` (the theme's
    // header prints the title, so leaving it in the body would set it
    // twice), yet all three renderers still print that title somewhere in
    // the body at heading size. Markdown can't tell the difference — its `#`
    // syntax looks the same whether it came from a real heading block or was
    // synthesised from `meta.title` — and an untagged PDF only has type size,
    // which the title shares with a real h1. Word is the only renderer that
    // can say structurally "this is the title, not a body heading": it gives
    // the title its own `DocTitle` style, distinct from `DocH1`. Going
    // through Markdown here would compare two sequences that were never the
    // same set — the title was never a `heading` block to begin with.
    const { doc } = ingestMarkdown(source);
    const xml = await docxPart(await renderDocx(doc, await loadTheme('plain'), { epochSeconds: EPOCH }), 'word/document.xml');
    const fromDocx = headingsFromDocx(xml);
    const fromIr = doc.blocks
      .filter((b): b is Extract<Block, { t: 'heading' }> => b.t === 'heading')
      .map((b) => `h${b.level} ${flattenInline(b.text)}`);
    expectSameSequence('heading', { label: 'IR', items: fromIr }, { label: 'Word', items: fromDocx });

    // Narrowing the comparison above to real heading blocks must not open a
    // hole where the title itself could silently vanish from the Word
    // document. It still has to be there, carrying the style that told the
    // heading comparison to leave it out.
    expect(docTitleFromDocx(xml), 'the title is missing its DocTitle style').toBe(doc.meta.title);
  });

  it('puts each table value in its own cell, which the PDF cannot show', async () => {
    // The PDF comparison flattens a table to a sequence of words because an
    // untagged PDF has no cell boundaries to read. Word has <w:tc>, so this is
    // the renderer that can catch a value landing in the wrong column with the
    // reading order unchanged.
    const { doc } = ingestMarkdown(source);
    const xml = await docxPart(await renderDocx(doc, await loadTheme('plain'), { epochSeconds: EPOCH }), 'word/document.xml');
    const table = doc.blocks.find((b) => b.t === 'table');
    expect(table).toBeDefined();
    const expected = [
      ...table!.head.map(flattenInline),
      ...table!.rows.flatMap((r) => r.map(flattenInline)),
    ];
    expectSameSequence('table cell', { label: 'IR', items: expected }, { label: 'Word', items: cellsFromDocx(xml) });
  });

  it('aligns each cell the column asked for, which the PDF cannot show', async () => {
    // Word carries alignment as `<w:jc>` on the cell's own paragraph — same
    // reasoning as the heading and link-target comparisons above: `align`
    // is structure the IR defines and Word reproduces, and an untagged PDF's
    // text extraction has no notion of alignment at all, so there is no third
    // opinion to reconcile and the IR is the only reference.
    //
    // The IR stores `align` once per column (`b.align[i]`), but Word stamps
    // it on every cell's paragraph, so comparing per column against Word's
    // header row alone would miss a body cell landing under the wrong
    // column's alignment. Comparing every cell instead — the column value
    // broadcast down each row, in the same reading order `cellsFromDocx`
    // already walks — means a value on the wrong column fails here exactly
    // the way it would fail the cell-value comparison above.
    const { doc } = ingestMarkdown(source);
    const xml = await docxPart(await renderDocx(doc, await loadTheme('plain'), { epochSeconds: EPOCH }), 'word/document.xml');
    const table = doc.blocks.find((b): b is Extract<Block, { t: 'table' }> => b.t === 'table');
    expect(table).toBeDefined();
    const column = (i: number) => table!.align[i] ?? 'l';
    const expected = [
      ...table!.head.map((_, i) => column(i)),
      ...table!.rows.flatMap((r) => r.map((_, i) => column(i))),
    ];
    expectSameSequence('cell alignment', { label: 'IR', items: expected }, { label: 'Word', items: alignFromDocx(xml) });
  });

  /**
   * One Markdown source through the ingester and the Word renderer. Taking a
   * source rather than reading the fixture is what lets the emphasis shapes
   * below be pinned at all: the kitchen sink's rendering is held by baseline
   * images a person approved, so a shape it does not have has to be built here
   * instead of added there.
   */
  async function wordFrom(markdownSource: string): Promise<{ doc: Doc; xml: string }> {
    const { doc } = ingestMarkdown(markdownSource);
    const xml = await docxPart(await renderDocx(doc, await loadTheme('plain'), { epochSeconds: EPOCH }), 'word/document.xml');
    return { doc, xml };
  }

  /**
   * Compared against the IR rather than against Markdown: the IR is the
   * contract a renderer is meant to honour, and PDF text extraction reports
   * no weight or style at all, so there is no third opinion to reconcile.
   */
  function expectEmphasisAgrees(doc: Doc, xml: string): void {
    expectSameSequence('bold run', { label: 'IR', items: emphasisFromIr(doc, 'strong') }, { label: 'Word', items: boldRunsFromDocx(xml) });
    expectSameSequence('italic run', { label: 'IR', items: emphasisFromIr(doc, 'em') }, { label: 'Word', items: italicRunsFromDocx(xml) });
  }

  it('carries the emphasis the IR asked for, which the PDF cannot show', async () => {
    const { doc, xml } = await wordFrom(source);
    expectEmphasisAgrees(doc, xml);
  });

  it('reports one span for emphasis that nests, not one per formatting change', async () => {
    // The fixture's emphasis is one bold word and one italic word, so on its
    // own this comparison only ever sees emphasis wrapping a single text node
    // — the one shape where a run and an emphasis node happen to coincide.
    // render/docx.ts promises that `**bold *and italic***` arrives as one run
    // that is both, which it does by carrying the formatting down to the
    // leaves; Word therefore receives two runs where the IR has one `strong`.
    // Both are right, and only the extractor's unit was wrong.
    const { doc, xml } = await wordFrom('# T\n\nA line with **bold *and italic* inside** it.\n');
    // Asserted, not merely compared: two empty sequences agree with each
    // other perfectly and would prove nothing about either side.
    expect(emphasisFromIr(doc, 'strong')).toEqual(['bold and italic inside']);
    expect(boldRunsFromDocx(xml)).toEqual(['bold and italic inside']);
    expect(emphasisFromIr(doc, 'em')).toEqual(['and italic']);
    expectEmphasisAgrees(doc, xml);
  });

  it('reports one span for emphasis broken by an inline code span', async () => {
    // The same unit mismatch by a different route: inline code changes the
    // run's font (and, since this branch, its size), so an emphasis containing
    // one is three Word runs for a single IR node.
    const { doc, xml } = await wordFrom('# T\n\nA line with **bold `code` more** in it.\n');
    expect(emphasisFromIr(doc, 'strong')).toEqual(['bold code more']);
    expect(boldRunsFromDocx(xml)).toEqual(['bold code more']);
    expectEmphasisAgrees(doc, xml);
  });

  it('keeps two emphasised spans apart when only plain text separates them', async () => {
    // The merge must not run away: adjacency in the XML is not sameness. Two
    // bold words with ordinary prose between them are two spans, and an
    // extractor that merged everything carrying the mark would pass the two
    // tests above while quietly reporting one span for a whole document.
    const { doc, xml } = await wordFrom('# T\n\n**First** ordinary words **second**.\n');
    expect(boldRunsFromDocx(xml)).toEqual(['First', 'second']);
    expectEmphasisAgrees(doc, xml);
  });

  it('points every link where the IR points it, which the PDF cannot show', async () => {
    const { doc } = ingestMarkdown(source);
    const buf = await renderDocx(doc, await loadTheme('plain'), { epochSeconds: EPOCH });
    const rels = await docxPart(buf, 'word/_rels/document.xml.rels');
    expectSameSequence('link target', { label: 'IR', items: linkTargetsFromIr(doc) }, { label: 'Word', items: linkTargetsFromRels(rels) });
  });
});
