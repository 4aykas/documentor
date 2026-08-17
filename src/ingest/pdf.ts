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
import { splitChrome, findRepeated, type ChromeRule } from './pdf/chrome.js';
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
 *  four phantom blank rows and its own title bleeding into the header cell.
 *
 *  0.75, not 0.8: bisected directly against both real documents (all four
 *  pages), `renderPdf`'s own decorative rect, and a hand-built boxed table,
 *  by sweeping the threshold and comparing the resulting grid shape and
 *  `usedRuns` count to the known-correct baseline. The value that keeps
 *  every case correct is NOT a wide plateau — it is bounded on both sides
 *  by a single real rectangle each:
 *    - Below ~0.6577, TEBIN P&L ACCOUNT page 1 and 2026 Revenue Estimation
 *      page 1 each draw one rectangle spanning their table's own full outer
 *      extent (a background/border behind the whole table, part of the same
 *      connected component as its cells, min(width, height) fraction
 *      measured at 0.6530 and 0.6577 respectively) that turns out to be
 *      load-bearing for one boundary Revenue page 1 has no other rectangle
 *      repeating — filtering it drops 15 of 82 runs from the table.
 *    - Above ~0.8392, `renderPdf`'s own page-frame rectangle (measured at
 *      exactly that width×height fraction) stops being filtered and the
 *      original corruption comes back.
 *  The safe range is therefore (0.6577, 0.8392], about 0.18 wide, and 0.8
 *  sat only 0.039 below its ceiling — closer to breaking than the "no cell
 *  spans 80% of the page" framing suggested. 0.75 sits close to the middle
 *  (0.092 below the floor, 0.089 below the ceiling) instead.
 *
 *  What would actually break this constant on a page neither real document
 *  has: a full-bleed table (cells touching the page edge on all four sides,
 *  shrinking the table's own margin-driven headroom below the threshold —
 *  the mechanism above, not a hypothetical one, already costs 0.18 of
 *  headroom against two ordinary A4/landscape financial statements); a
 *  drawn page border sized between the real table's own outer-background
 *  fraction and this one (nothing separates "the table's background" from
 *  "the page's border" but relative size, so a page bordered tighter than
 *  ~84% width×height would need a lower threshold, and a smaller border
 *  would slip through and reintroduce the corruption); a watermark drawn as
 *  one large rectangle rather than text, sized similarly. A landscape sheet
 *  does NOT independently threaten this constant: the threshold compares
 *  against `widthPt`/`heightPt` read per page, so 0.75 of a landscape
 *  page's own (shorter) height is already what gets compared against —
 *  confirmed directly, both Revenue Estimation pages (842×595) match the
 *  baseline throughout the same safe range as the portrait P&L pages. */
const PAGE_FRAME_FRACTION = 0.75;

/** How far apart two pages' column x-positions can be and still count as
 *  "the same drawn columns" for a table join — measured on TEBIN P&L
 *  ACCOUNT's own two halves (xs differ by at most ~0.6pt between page 1
 *  and page 2), doubled for slack rather than shipped at the measured
 *  value itself. */
const COLUMN_POSITION_TOL = 3;

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

/** A block made of exactly one text run whose literal text was OBSERVED by
 *  `findRepeated` to sit at a position that recurs on every page. RULING 22:
 *  the join below must not be broken by a letterhead the operator never
 *  declared away. `chrome.ts` will not delete an undeclared run — that stays
 *  the caller's decision, exactly as the spec insists — but the reader
 *  already KNOWS this run repeats; treating that known fact as "this cannot
 *  be the boundary between two unrelated tables" is reading the observation
 *  `findRepeated` exists to produce, not inventing a new one. */
function isRepeatedTextBlock(b: Block, repeatedTexts: ReadonlySet<string>): boolean {
  return (b.t === 'para' || b.t === 'heading') && b.text.length === 1 && b.text[0]!.t === 'text' && repeatedTexts.has(b.text[0]!.v);
}

/** The block a table-join decision should treat as "whatever came right
 *  before this page's table" — the tail of `blocks`, skipping over any
 *  trailing run of blocks `findRepeated` observed to repeat on every page.
 *  Skipping is not deleting: every repeated-text block already pushed stays
 *  exactly where it is in `blocks`, in reading order, visible in the
 *  output. This only changes what counts as "something genuinely sits
 *  between the two tables" for the join test below — a letterhead does not,
 *  a section heading that is unique to this page does (it was never in
 *  `repeatedTexts`, because `findRepeated` requires presence on EVERY page
 *  to call something repeated at all). Walking back past more than one
 *  page's worth of repeated blocks is what lets a table spanning three or
 *  more pages join across each break, not just the first. */
function joinAnchor(blocks: readonly Block[], repeatedTexts: ReadonlySet<string>): Block | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]!;
    if (isRepeatedTextBlock(b, repeatedTexts)) continue;
    return b;
  }
  return undefined;
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
  // Computed once, on the body that survived any DECLARED chrome rule (an
  // already-removed run cannot sit between two tables to begin with). Used
  // only to decide what "genuinely intervenes" for the join below —
  // RULING 22 — never to remove anything: the runs themselves are still
  // pushed as ordinary paragraph/heading blocks a few lines down.
  const repeatedTexts = new Set(findRepeated(body).flatMap((b) => b.texts));
  const blocks: Block[] = [];
  // The xs of whichever table's grid was most recently read — the running
  // continuation candidate's own drawn column layout, compared against the
  // NEXT page's grid before a join is allowed. Column count alone accepts
  // two tables that happen to agree on how many columns they have and
  // nothing else; two truly independent tables with no prose of any kind
  // between them (no letterhead, no heading — the one case `joinAnchor`
  // cannot see anything to stop on) would otherwise merge silently. A
  // genuine continuation draws its columns at the same x positions as the
  // fragment before it (measured: TEBIN P&L ACCOUNT page 1 vs. page 2, xs
  // agree to within 0.6pt), so requiring that agreement closes the gap
  // without inventing anything — it is the same drawn structure the whole
  // grid, one page earlier, already committed to.
  let lastTableXs: readonly number[] | undefined;
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
    // half after keeps a re-issued page in the order the source actually
    // reads in. It is NOT what decides whether the table below joins the
    // one before it — `joinAnchor` (RULING 22) does that, by looking past
    // any repeated-text furniture in `blocks`, declared away or not. The
    // two are deliberately separate concerns: TEBIN P&L ACCOUNT's second
    // page still prints its own letterhead here, above its table, exactly
    // where the source has it — it simply no longer counts as "something
    // genuinely intervenes" once `findRepeated` has confirmed it repeats.
    // 2026 Revenue Estimation's second page prints a section heading above
    // an unrelated table that is NOT observed to repeat (each page's
    // heading names something different), so `joinAnchor` stops there and
    // the join correctly does not fire — summing "Top 8 clients" and
    // "Potential additions" into one table by column count alone would
    // have been exactly the silent-merge failure this design exists to
    // prevent.
    if (grid !== null) {
      const gridTop = Math.max(...grid.ys);
      const above = prose.filter((r) => r.y >= gridTop);
      const below = prose.filter((r) => r.y < gridTop);
      blocks.push(...proseBlocks(above, levels));

      // `table` is never null here (`grid !== null` implies `tableFrom` ran),
      // and `table.rows.length` is never 0 (grid.ts's own `ys.length < 2`
      // check already refused that shape before this ever runs) — so
      // nothing beyond `table !== null` is a real guard. An earlier version
      // of this required `table.rows.length > 1`, which silently dropped
      // any single-row grid entirely: its runs were already claimed by
      // `tableFrom` (excluded from `prose` above) but no table block was
      // ever pushed to carry them, and a continuation fragment whose OWN
      // grid happens to be exactly one row (this file's own tests: a table
      // split so that one fragment carries a single row) was lost the same
      // way. `table.rows.length === 1` is not degenerate — grid.ts already
      // refuses the genuinely degenerate case (a single box, one column and
      // one row at once) at the grid level; a one-row, multi-column grid is
      // an ordinary small table this reader has every reason to keep.
      if (table !== null) {
        // Column count alone is not enough: 2026 Revenue Estimation draws
        // two unrelated tables, one per page, each with its own boxed
        // header row repeating the same six column captions ("TOP 10
        // CLIENTS 2025", "COUNTRY", …) — same shape, same width, nothing to
        // do with each other, separated by a section heading that is
        // UNIQUE to each page (never observed twice, so `joinAnchor` cannot
        // skip past it). The join requires two things: nothing but
        // repeated-text furniture — RULING 22 — sits between this table and
        // the last one (`joinAnchor`, not a raw "immediately previous
        // block" check, or TEBIN P&L ACCOUNT's own undeclared letterhead
        // would wrongly read as two tables), AND this page's own first grid
        // row differs from the running table's head: TEBIN P&L ACCOUNT's
        // second page resumes with "CTC result", never repeating
        // "2024"/"2025"/"2026", which is what a real continuation looks
        // like — a page whose own table repeats the header it would be
        // continuing is declaring itself a new table, not asking to be
        // joined to the last one.
        const prev = joinAnchor(blocks, repeatedTexts);
        // On a genuine continuation there is no header row on this page at
        // all — `table.rows[0]` is the first BODY row of the continuation
        // (TEBIN P&L ACCOUNT's second page starts "CTC result", a real
        // figure, not a caption). The joined table's `head` therefore comes
        // from the FIRST fragment only, once, and every row of every later
        // fragment — including its own `rows[0]` — is a body row pushed
        // onto `prev.rows`. Only when the join does NOT fire does this
        // page's `rows[0]` get treated as a head at all, because only then
        // is it actually behaving as one (a new table's own real header).
        const head = table.rows[0]!.map(text);
        const rows = table.rows.slice(1).map((r) => r.map(text));
        const prevHeadTexts = prev !== undefined && prev.t === 'table'
          ? prev.head.map((c) => c.map((n) => (n.t === 'text' ? n.v : '')).join(''))
          : null;
        const headerRepeats = prevHeadTexts !== null
          && prevHeadTexts.length === table.rows[0]!.length
          && prevHeadTexts.every((t, idx) => t === table.rows[0]![idx]);
        // Two independent tables with matching column counts and no prose
        // of any kind between them are the one shape neither `joinAnchor`
        // nor `headerRepeats` can tell apart from a genuine continuation —
        // requiring their drawn column positions to agree closes it.
        const xsMatch = lastTableXs !== undefined
          && lastTableXs.length === grid.xs.length
          && lastTableXs.every((x, idx) => Math.abs(x - grid.xs[idx]!) <= COLUMN_POSITION_TOL);
        if (prev !== undefined && prev.t === 'table' && prev.head.length === head.length && !headerRepeats && xsMatch) {
          prev.rows.push(...[head, ...rows]);
        } else {
          blocks.push({ t: 'table', head, rows, align: head.map(() => 'l' as const) });
        }
        lastTableXs = grid.xs;
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
