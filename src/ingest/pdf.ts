// The fourth ingester, and the only one whose input has no structure to read:
// a PDF is positioned glyphs and drawn paths. Everything here is inference,
// which is why the grid comes from what the document draws (grid.ts), the
// letterhead is REPORTED by what repeats but only REMOVED when the operator
// declares where (chrome.ts) — see docs/superpowers/specs/2026-08-16-pdf-
// ingest-design.md, "Identifying page furniture" — and why a later token
// gate (task 5) has the last word before anything is written.

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Block, Doc, Ingested, Inline } from '../ir/types.js';
import { readPageGeometry, type TextRun, type Rect } from './pdf/geometry.js';
import { splitChrome, type ChromeRule } from './pdf/chrome.js';
import { findGrid, tableFrom } from './pdf/grid.js';

export const PDF_MAX_PAGES = 60;
export const PDF_MAX_RECTS_PER_PAGE = 5000;

const OP_PAINT_IMAGE = 85;
const text = (v: string): Inline[] => [{ t: 'text', v }];

/** A rectangle covering most of the page in BOTH dimensions is a background
 *  or a frame, never a table cell — measured directly against this
 *  project's own `renderPdf` output, which draws exactly one such rect per
 *  page (its content box, at a uniform margin from all four edges) beside
 *  every table and every plain-prose page alike. Left in, that one
 *  rectangle corrupts grid.ts's own boundary detection two ways at once:
 *  `rectComponents` glues it to anything whose edge happens to land near
 *  the page's own margin (the commonest table layout there is — indented to
 *  the same margin the background sits at), and `boundaries()` then force-
 *  includes the background's OWN, unrepeated top/bottom/left/right edges as
 *  "the table's outer boundary", since they are the extreme values in the
 *  merged set. A page with no table at all was measured turning entirely
 *  into a single garbled table cell this way (every run on the page
 *  concatenated into one string); a page with a real table gained two to
 *  four phantom blank rows and its own title bleeding into the header
 *  cell. No table cell in either real financial document, or in anything
 *  this project itself draws, spans 80% of the page in both directions at
 *  once — a table's outer edge is real, but a single CELL that big is not
 *  a shape this reader needs to support to read a real table correctly. */
const PAGE_FRAME_FRACTION = 0.8;

function withoutPageFrame(rects: readonly Rect[], widthPt: number, heightPt: number): Rect[] {
  return rects.filter(
    (r) => (r.x1 - r.x0) < PAGE_FRAME_FRACTION * widthPt || (r.y1 - r.y0) < PAGE_FRAME_FRACTION * heightPt,
  );
}

/** Body is the size most runs are set in; each distinct larger size is a
 *  heading level, largest first. A document with one size has no headings —
 *  which is the truth about it, not a failure to find them. */
function headingLevels(runs: readonly TextRun[]): Map<number, 1 | 2 | 3> {
  const tally = new Map<number, number>();
  for (const r of runs) {
    const k = Math.round(r.sizePt * 2) / 2;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  const body = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const bigger = [...tally.keys()].filter((s) => s > body).sort((a, b) => b - a);
  const out = new Map<number, 1 | 2 | 3>();
  bigger.forEach((s, i) => out.set(s, (Math.min(i + 1, 3) as 1 | 2 | 3)));
  return out;
}

/** A page's runs that a grid's table did not claim, turned into blocks in
 *  reading order (top to bottom), the modal-size-relative heading level
 *  applied to each. Shared by the with-grid and no-grid cases below so
 *  "how a bare run becomes a heading or a paragraph" has one definition. */
function proseBlocks(runs: readonly TextRun[], levels: ReadonlyMap<number, 1 | 2 | 3>): Block[] {
  const out: Block[] = [];
  for (const r of [...runs].sort((a, b) => b.y - a.y)) {
    const level = levels.get(Math.round(r.sizePt * 2) / 2);
    out.push(level === undefined ? { t: 'para', text: text(r.text) } : { t: 'heading', level, text: text(r.text) });
  }
  return out;
}

export async function ingestPdf(
  bytes: Uint8Array | Buffer,
  opts: { title?: string; subtitle?: string; date?: string; entity?: string; chrome?: ChromeRule } = {},
  limits: { maxPages?: number } = {},
): Promise<Ingested> {
  const maxPages = limits.maxPages ?? PDF_MAX_PAGES;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  if (pdf.numPages > maxPages) {
    throw new Error(`this PDF has ${pdf.numPages} pages, past the ${maxPages}-page limit a re-issued document is held to`);
  }

  const dropped: string[] = [];
  const geometry = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const ops = await page.getOperatorList();
    const images = ops.fnArray.filter((f: number) => f === OP_PAINT_IMAGE).length;
    if (images > 0) dropped.push(`page ${n}: ${images} image(s) — this ingester carries no picture out of a PDF`);
    const g = await readPageGeometry(page);
    if (g.rotated > 0) dropped.push(`page ${n}: ${g.rotated} run(s) of rotated text — read sideways, carried nowhere`);
    if (g.rects.length > PDF_MAX_RECTS_PER_PAGE) {
      throw new Error(`page ${n} draws ${g.rects.length} rectangles, past the ${PDF_MAX_RECTS_PER_PAGE} a table is expected to need`);
    }
    geometry.push(g);
  }

  // Page furniture is declared, never inferred (chrome.ts's own header
  // comment, and the design doc's "Identifying page furniture"). An
  // undeclared rule ({}) removes nothing; splitChrome's own `dropped` then
  // carries findRepeated's advisory instead, so an operator who ran this
  // once without declaring anything sees exactly what repeats and where —
  // never a silent deletion.
  const { body, dropped: chromeDropped } = splitChrome(geometry.map((g) => g.runs), opts.chrome ?? {});
  dropped.push(...chromeDropped);

  const levels = headingLevels(body.flat());
  const blocks: Block[] = [];
  for (const [i, runs] of body.entries()) {
    // grid.ts's `findGrid` takes the largest connected component on the
    // page, not every component `rectComponents` finds. Measured directly
    // against both real documents (see task-4-report.md): a page's smaller
    // components are not secondary tables, they are decorative structure —
    // a full-page background rectangle plus a frame, 5-7 rects, whose own
    // "grid" spans the page's entire extent and therefore claims *every*
    // run on the page, prose and table alike, as its cells. Iterating
    // rectComponents and calling findGridInComponent (via findGrid on each
    // component) on every one of them would read that background as a
    // second, false table swallowing the real one's runs. The single
    // largest-component path is not a shortcut being tolerated here; it is
    // the one that measurably gets both documents right, and the fallback
    // this project would need for a genuine two-table page does not exist
    // in either fixture to validate against.
    const g = geometry[i]!;
    const grid = findGrid(withoutPageFrame(g.rects, g.widthPt, g.heightPt));
    const table = grid === null ? null : tableFrom(grid, runs);
    const prose = runs.filter((r) => table === null || !table.usedRuns.has(r));

    // A run the grid didn't claim is not necessarily letterhead sitting
    // above the table — real content sits below one too (a footnote, a
    // footer, an explanatory line under a boxed table that doesn't reach
    // the page's own margin). Splitting prose by the grid's own vertical
    // extent and pushing the "above" half before the table, the "below"
    // half after, does two things at once: it keeps a re-issued page in
    // the order the source actually reads in, and it makes the
    // continuation-join below fire only when nothing but the previous
    // table sits immediately before this page's — exactly the signal that
    // tells the two real documents' shapes apart. TEBIN P&L ACCOUNT's
    // second page has nothing left above its table once the letterhead is
    // declared away, so it joins page one's table; 2026 Revenue
    // Estimation's second page repeats its own section heading above an
    // unrelated table, which lands in `above` and blocks the join — the
    // correct outcome, since summing "Top 8 clients" and "Potential
    // additions" into one table by column count alone would have been
    // exactly the silent-merge failure this design exists to prevent.
    if (grid !== null) {
      const gridTop = Math.max(...grid.ys);
      const above = prose.filter((r) => r.y >= gridTop);
      const below = prose.filter((r) => r.y < gridTop);
      blocks.push(...proseBlocks(above, levels));

      if (table !== null && table.rows.length > 1) {
        const prev = blocks[blocks.length - 1];
        const head = table.rows[0]!.map(text);
        const rows = table.rows.slice(1).map((r) => r.map(text));
        // Column count alone is not enough: 2026 Revenue Estimation draws
        // two unrelated tables, one per page, each with its own boxed
        // header row repeating the same six column captions ("TOP 10
        // CLIENTS 2025", "COUNTRY", …) — same shape, same width, nothing to
        // do with each other. The `above`/`below` split already blocks most
        // false joins (a section title sitting between the two tables lands
        // in `above` and breaks the immediate-previous-block check), but a
        // continuation page with no such title and a genuinely repeated
        // header would still pass that check on column count alone. So the
        // join also requires this page's own first grid row to differ from
        // the running table's head: TEBIN P&L ACCOUNT's second page resumes
        // with "CTC result", never repeating "2024"/"2025"/"2026", which is
        // what a real continuation looks like — a page that repeats the
        // header it's continuing from is declaring itself a new table, not
        // asking to be joined to the last one.
        const prevHeadTexts = prev !== undefined && prev.t === 'table'
          ? prev.head.map((c) => c.map((n) => (n.t === 'text' ? n.v : '')).join(''))
          : null;
        const headerRepeats = prevHeadTexts !== null
          && prevHeadTexts.length === table.rows[0]!.length
          && prevHeadTexts.every((t, idx) => t === table.rows[0]![idx]);
        if (prev !== undefined && prev.t === 'table' && prev.head.length === head.length && !headerRepeats) {
          prev.rows.push(...[head, ...rows]);
        } else {
          blocks.push({ t: 'table', head, rows, align: head.map(() => 'l' as const) });
        }
      }

      blocks.push(...proseBlocks(below, levels));
    } else {
      blocks.push(...proseBlocks(prose, levels));
    }
  }

  const meta: Doc['meta'] = {
    title: opts.title ?? 'Untitled',
    lang: 'en',
    ...(opts.subtitle === undefined ? {} : { subtitle: opts.subtitle }),
    ...(opts.date === undefined ? {} : { date: opts.date }),
    ...(opts.entity === undefined ? {} : { entity: opts.entity }),
  };
  return { doc: { meta, blocks }, dropped };
}
