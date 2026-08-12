// `documentor inspect` — see docs/superpowers/specs/2026-08-12-documentor-design.md,
// "The skill, and why the dialogue is written to a file". Its whole point is
// to answer "what will build do with this?" before anything is drawn: no
// Chromium, no PDF, no file written. It reads the same Doc `build` would
// render (via build.ts's own `ingest`), runs it through the same
// `validateDoc` gate, and reports on the IR that comes out the other side —
// never on the source text, since the IR is what a renderer would actually
// see.
//
// One structure, two renderings, per the design's own settled decision: the
// Markdown form is for a human reading a terminal, `--json` is what the
// skill parses, and both come from the same `InspectResult` so they cannot
// disagree. test/cli/inspect.test.ts is what proves that, not a convention
// this file has to uphold by discipline alone.

import { basename, extname, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { RASTER as DOCX_RASTER } from '../render/docx.js';
import type { Block, Doc, Inline } from '../ir/types.js';
import { validateDoc } from '../ir/validate.js';
import { loadTheme, type Theme } from '../theme/resolve.js';
import { PAGE_PT } from '../theme/types.js';
import { discoverInputs, ingest, READABLE_EXTS } from './build.js';

type Io = { log: (s: string) => void; err: (s: string) => void };

/**
 * One count per block type the IR can hold. Read from the IR itself, never
 * from the source — the design's own rule for `understood`. A `<div>` in the
 * Markdown source and a table dropped from a .docx both leave no trace here;
 * they show up in `dropped` instead, because this counts only what actually
 * survived into the Doc a renderer would draw.
 *
 * `lists` counts list *blocks*, not list *items*: the IR is flat, and a
 * single visually-nested list becomes several sibling `list` blocks the
 * moment something interrupts it (see md.ts's and docx.ts's own comments on
 * why) — so this is an honest count of what the IR holds, not a re-derived
 * "how many bullets did the source have".
 */
export type Counts = {
  headings: number;
  paragraphs: number;
  lists: number;
  tables: number;
  images: number;
  code: number;
  quotes: number;
  rules: number;
  pagebreaks: number;
};

/**
 * What one document's inspection produced. A discriminated union on `status`
 * rather than one shape with optional fields for every outcome: a `failed`
 * document was never ingested, so it has no `dropped` to report and no
 * `counts` to have computed — a shape that could carry them anyway would let
 * a caller ask for fields that were never filled in.
 *
 * Mirrors the three outcomes named in the report: `ok` is a readable
 * document (exit 0), `refused` is one `build` would also refuse — it failed
 * `validateDoc`, the same gate `build` runs (exit 3) — and `failed` is one
 * this ingester could not read at all: a corrupt zip, a missing part, an
 * extension neither ingester handles (exit 1, the same "uncaught throw"
 * class `build` uses for the same failures).
 */
export type DocInspection =
  | {
      file: string;
      status: 'ok';
      title: string;
      hasSubtitle: boolean;
      hasDate: boolean;
      hasEntity: boolean;
      counts: Counts;
      /** Exactly what the ingester returned — not re-derived or re-worded.
       *  The ingesters own this vocabulary; a second phrasing of the same
       *  loss here is how the two would drift, which is the one thing the
       *  design explicitly rules out. */
      dropped: string[];
      warnings: string[];
    }
  | { file: string; status: 'refused'; reason: string; dropped: string[] }
  | { file: string; status: 'failed'; reason: string };

export type InspectResult = {
  /** The theme id the width warning (and nothing else) was computed against
   *  — see computeWarnings' own comment on why a table-width warning needs
   *  page geometry at all. */
  theme: string;
  documents: DocInspection[];
};

function emptyCounts(): Counts {
  return {
    headings: 0, paragraphs: 0, lists: 0, tables: 0, images: 0, code: 0, quotes: 0, rules: 0, pagebreaks: 0,
  };
}

function countBlocks(blocks: readonly Block[]): Counts {
  const c = emptyCounts();
  for (const b of blocks) {
    switch (b.t) {
      case 'heading': c.headings++; break;
      case 'para': c.paragraphs++; break;
      case 'list': c.lists++; break;
      case 'table': c.tables++; break;
      case 'image': c.images++; break;
      case 'code': c.code++; break;
      case 'quote': c.quotes++; break;
      case 'rule': c.rules++; break;
      case 'pagebreak': c.pagebreaks++; break;
    }
  }
  return c;
}

function plainText(nodes: readonly Inline[]): string {
  return nodes.map((n) => (n.t === 'text' ? n.v : plainText(n.children))).join('');
}

/**
 * The minimum column width, in points, this file treats as still legible —
 * used only to decide whether a table warning fires, never to lay anything
 * out (no renderer in this project owns a wide-table policy yet; see the
 * design's "three details settled" on why the IR itself carries no
 * `landscape` field). docx.ts's table() spends 12pt of every column on cell
 * padding (6pt each side) before a single character is drawn, so 48pt is
 * the point past which "12pt of padding plus a couple of characters" starts
 * to look reasonable rather than cramped. It is also, not by coincidence,
 * the value that makes an 11-column table trip this warning on the default
 * A4-portrait page (usable width ≈499pt / 48 ≈ 10.4 columns) — the exact
 * example the design's own sketch of `inspect` gives.
 */
const MIN_LEGIBLE_COL_PT = 48;

/**
 * Things that are not losses (nothing here is missing from the IR) but will
 * surprise whoever opens the result — and each one names something a person
 * could act on: add the missing heading level, ask for landscape or a
 * narrower table, supply a title, or expect a placeholder in Word. A warning
 * with no action a reader could take is left out on purpose — see this
 * file's own module comment and the task's instruction that an unearned
 * warning trains people to stop reading the list.
 */
function computeWarnings(doc: Doc, theme: Theme): string[] {
  const warnings: string[] = [];

  // Both ingesters fall back to the literal string 'Untitled' only when
  // nothing else supplied a title (build.ts's own `ingest` wrapper already
  // fills a titleless .docx in from its filename before this ever runs, so
  // this only ever fires for a Markdown document with no h1 and no
  // --title) — worth flagging before a themed header prints that word.
  if (doc.meta.title === 'Untitled') {
    warnings.push('no title found — the document will print as "Untitled" until one is supplied');
  }

  // A well-formed outline goes up by any amount but down by only one level
  // at a time (H1 → H2 → H3, never H1 → H3). A jump means the source skipped
  // a level, or an ingester clamped one it could not represent (both
  // ingesters clamp anything past H3) — either way the rendered heading
  // sequence will look wrong to a reader with no note explaining why.
  let prevLevel: number | undefined;
  let headingIndex = 0;
  for (const b of doc.blocks) {
    if (b.t !== 'heading') continue;
    headingIndex++;
    if (prevLevel !== undefined && b.level > prevLevel + 1) {
      warnings.push(`heading levels jump H${prevLevel}→H${b.level} at heading ${headingIndex} ("${plainText(b.text)}")`);
    }
    prevLevel = b.level;
  }

  // See MIN_LEGIBLE_COL_PT's own comment for where 48pt comes from. `cols` is
  // just `head.length` here, not the max-over-rows computation docx.ts's own
  // table() needs — validateDoc, run just before this, already refused any
  // table whose rows disagree with its head's column count.
  const usableWidthPt = PAGE_PT[theme.page.size].w - theme.page.marginPt * 2;
  const maxLegibleCols = Math.floor(usableWidthPt / MIN_LEGIBLE_COL_PT);
  let tableIndex = 0;
  for (const b of doc.blocks) {
    if (b.t !== 'table') continue;
    tableIndex++;
    if (b.head.length > maxLegibleCols) {
      warnings.push(`table ${tableIndex} has ${b.head.length} columns (will not fit ${theme.page.size} portrait)`);
    }
  }

  // render/docx.ts embeds only a PNG data: URI (DOCX_RASTER, imported from
  // there rather than re-declared here — the design's own "read once" rule
  // for what an ingester returns applies just as much to what a renderer
  // will accept). Anything else — JPEG, GIF, SVG — draws a bordered
  // placeholder instead, a named residual of that renderer's own docs. This
  // is deliberately not conditioned on which formats the caller intends to
  // build: DOCX is always one of the formats `build --to` can be asked for,
  // so the warning holds regardless of --theme or a future --to on inspect.
  let imageIndex = 0;
  for (const b of doc.blocks) {
    if (b.t !== 'image') continue;
    imageIndex++;
    if (!DOCX_RASTER.test(b.src)) {
      warnings.push(`image ${imageIndex} will not embed in Word — only PNG embeds; a .docx build will draw a placeholder instead`);
    }
  }

  return warnings;
}

/**
 * Ingests, validates, and — only if both succeed — counts and inspects. The
 * three status branches below are exactly the three outcomes the report
 * commits to; see DocInspection's own doc comment for how each maps to an
 * exit code.
 */
async function inspectDoc(
  file: string, ext: '.docx' | '.md' | '.markdown', theme: Theme,
): Promise<DocInspection> {
  let doc: Doc;
  let dropped: string[];
  try {
    ({ doc, dropped } = await ingest(ext, file, {}));
  } catch (e) {
    return { file, status: 'failed', reason: (e as Error).message };
  }
  try {
    validateDoc(doc);
  } catch (e) {
    return { file, status: 'refused', reason: (e as Error).message, dropped };
  }
  return {
    file,
    status: 'ok',
    title: doc.meta.title,
    hasSubtitle: doc.meta.subtitle !== undefined,
    hasDate: doc.meta.date !== undefined,
    hasEntity: doc.meta.entity !== undefined,
    counts: countBlocks(doc.blocks),
    dropped,
    warnings: computeWarnings(doc, theme),
  };
}

const COUNT_LABELS: { key: keyof Counts; one: string; many: string }[] = [
  { key: 'headings', one: 'heading', many: 'headings' },
  { key: 'paragraphs', one: 'paragraph', many: 'paragraphs' },
  { key: 'lists', one: 'list', many: 'lists' },
  { key: 'tables', one: 'table', many: 'tables' },
  { key: 'images', one: 'image', many: 'images' },
  { key: 'code', one: 'code block', many: 'code blocks' },
  { key: 'quotes', one: 'quote', many: 'quotes' },
  { key: 'rules', one: 'rule', many: 'rules' },
  { key: 'pagebreaks', one: 'page break', many: 'page breaks' },
];

/** Renders one `ok` document's `understood:` line. Every word here is
 *  derived from fields already on `DocInspection`, never invented — the
 *  parity test walks this same structure to check that. */
function renderUnderstood(d: Extract<DocInspection, { status: 'ok' }>): string {
  const parts: string[] = [d.title === 'Untitled' ? 'no title' : `title "${d.title}"`];
  for (const { key, one, many } of COUNT_LABELS) {
    const n = d.counts[key];
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  }
  return parts.join(', ');
}

function renderOneHuman(d: DocInspection): string[] {
  if (d.status === 'failed') return [`  failed: ${d.reason}`];
  if (d.status === 'refused') {
    const lines = [`  refused: ${d.reason}`];
    lines.push(d.dropped.length ? `  dropped:    ${d.dropped.join('; ')}` : '  dropped:    nothing');
    return lines;
  }
  const lines = [`  understood: ${renderUnderstood(d)}`];
  lines.push(d.dropped.length ? `  dropped:    ${d.dropped.join('; ')}` : '  dropped:    nothing');
  lines.push(d.warnings.length ? `  warnings:   ${d.warnings.join('; ')}` : '  warnings:   none');
  return lines;
}

/** The Markdown form — for the human at the terminal. `--json` renders the
 *  same `InspectResult`, never a second computation over the Doc, so the two
 *  cannot say different things about the same document. */
export function renderHuman(result: InspectResult): string {
  const lines: string[] = [];
  const many = result.documents.length > 1;
  for (const d of result.documents) {
    if (many) lines.push(basename(d.file));
    lines.push(...renderOneHuman(d));
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function parseInspectArgs(argv: string[]): {
  input?: string; theme: string; json: boolean; recursive: boolean;
} {
  const out: { input?: string; theme: string; json: boolean; recursive: boolean } = {
    theme: 'plain', json: false, recursive: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--theme') out.theme = next();
    // Machine form for the skill; see this file's module comment. Not a
    // second code path — renderHuman/JSON.stringify both read the same
    // InspectResult built once, below.
    else if (a === '--json') out.json = true;
    else if (a === '--recursive') out.recursive = true;
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else if (out.input === undefined) out.input = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  return out;
}

/**
 * Exit codes. Deliberately the same four codes `build` uses, for the same
 * reasons (see the contract in src/bin/documentor.ts) — a script that
 * already knows what 0/1/2/3 mean from `build` does not have to learn a
 * second vocabulary for `inspect`:
 *   0  every document inspected read cleanly (an `ok` batch of one or many)
 *   1  something could not be read at all — a bad option value aside, this
 *      is the same "uncaught throw" class `build` reports as 1: a missing
 *      file, a corrupt zip, an unreadable subdirectory in a batch
 *   2  usage error — no input, an extension neither ingester reads, or (for
 *      a directory) nothing readable found at all; the command as typed
 *      cannot be carried out, the same meaning `build` gives this code
 *   3  refused — `validateDoc` would also refuse this document at build
 *      time; inspect still reports what dropped along the way, but prints
 *      no `understood`/`warnings` for a Doc it cannot vouch for
 * A directory batch folds to the worst outcome across its documents, the
 * same rule runBuildBatch already uses: failed outranks refused outranks ok.
 */
export async function runInspect(argv: string[], io: Io): Promise<number> {
  let args: ReturnType<typeof parseInspectArgs>;
  try {
    args = parseInspectArgs(argv);
  } catch (e) {
    io.err(`documentor: ${(e as Error).message}`);
    return 2;
  }
  if (args.input === undefined) {
    io.err('documentor: inspect needs an input file or directory\n\n  documentor inspect <file|dir> [--theme plain] [--json] [--recursive]');
    return 2;
  }

  const theme = await loadTheme(args.theme);
  const inputArg = resolve(args.input);
  const inputStat = await stat(inputArg).catch(() => undefined);

  let documents: DocInspection[];
  let batchFailed = false;
  if (inputStat?.isDirectory()) {
    const discovered = await discoverInputs(inputArg, args.recursive, theme.id);
    if (discovered.inputs.length === 0) {
      io.err(`documentor: no readable input under ${inputArg} (looked for ${[...READABLE_EXTS].join(', ')}${args.recursive ? ', recursively' : ''})`);
      return 2;
    }
    documents = [];
    for (const file of discovered.inputs) {
      const ext = extname(file).toLowerCase() as '.md' | '.markdown' | '.docx';
      documents.push(await inspectDoc(file, ext, theme));
    }
    batchFailed = discovered.unreadableDirs.length > 0;
  } else {
    const ext = extname(inputArg).toLowerCase();
    if (ext !== '.md' && ext !== '.markdown' && ext !== '.docx') {
      io.err(`documentor: cannot read ${ext || 'a file with no extension'} yet — inspect reads .md and .docx`);
      return 2;
    }
    documents = [await inspectDoc(inputArg, ext, theme)];
  }

  const result: InspectResult = { theme: theme.id, documents };
  io.log(args.json ? JSON.stringify(result, null, 2) : renderHuman(result));

  if (batchFailed || documents.some((d) => d.status === 'failed')) return 1;
  if (documents.some((d) => d.status === 'refused')) return 3;
  return 0;
}
