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
//
// It also resolves a sidecar exactly the way build.ts does — through the
// same config.ts `resolveConfig` — because two commands answering "what
// will this print" differently for the same input is the defect `inspect`
// exists to prevent (see docs/superpowers/specs/2026-08-12-sidecar-design.md,
// "Verification": "inspect reads the sidecar too, and by the same rules").

import { basename, extname, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { canEmbedInDocx } from '../render/docx.js';
import type { Block, Doc, Inline } from '../ir/types.js';
import { validateDoc } from '../ir/validate.js';
import { loadTheme, type Theme } from '../theme/resolve.js';
import { PAGE_PT } from '../theme/types.js';
import { checkFormats, discoverInputs, ingest, READABLE_EXTS, type IngestOpts } from './build.js';
import { resolveConfig, type ConfigFlags, DEFAULT_THEME } from './config.js';

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
  heatmaps: number;
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
 * extension neither ingester handles, or (in a directory batch) a sidecar
 * that did not resolve — see runInspect's own comment on why that last one
 * is a per-document 'failed' in a batch but a hard usage-error exit for a
 * single file (exit 1, the same "uncaught throw" class `build` uses for the
 * same failures).
 */
export type DocInspection =
  | {
      file: string;
      status: 'ok';
      title: string;
      // `title`/`subtitle`/`date`/`entity` are meta.doc fields verbatim
      // (subtitle/date/entity present only when the document — or
      // `inspect`'s own --date/--entity/a sidecar — supplied one;
      // exactOptionalPropertyTypes means an absent fact is an absent key,
      // never an explicit `undefined`). They exist here because all four
      // print on the themed letterhead at build time, so a person deciding
      // whether the build is ready to run wants to see exactly what will
      // land there — not just "yes/no, one was found" but the actual text.
      //
      // `inspect` accepts `--title`/`--date`/`--entity`, spelled and
      // behaving exactly like `build`'s own flags, and now also `--config`/
      // `--no-config`, because each one changes what `build` would print
      // and `inspect`'s whole purpose is to preview that before `build`
      // runs:
      //   - `entity` has no source *inside* a document at all — it can
      //     only ever come from a caller-supplied value (a flag or a
      //     sidecar).
      //   - `date` can come from a document (the DOCX header/footer scan),
      //     but an explicit `--date`, then a sidecar's `date`, must win
      //     over a scanned one at inspect time exactly because each does
      //     at build time (see ingestDocx's own `opts.date ?? foundDate`
      //     and config.ts's own precedence).
      //   - `title` can also come from a document — Markdown's h1, or a
      //     DOCX's own DocTitle body style — but a titleless `.docx` has
      //     *no* body title at all; `build.ts`'s own `ingest()` wrapper
      //     falls back to the file's name in that case, and an explicit
      //     `--title` or sidecar `title` must outrank that fallback the
      //     same way it does at build time.
      // Two commands answering "what will this print" differently for the
      // same input and the same intended flags is the exact failure this
      // command exists to prevent.
      //
      // Every one of these facts is rendered in renderUnderstood below; a
      // fact that appeared only in this structure and never in the human
      // text would be exactly the disagreement the design's "one structure,
      // two renderings" rule exists to prevent, and test/cli/inspect.test.ts's
      // parity test walks this structure at runtime (not a hand-maintained
      // field list) to catch a future field added here without a renderer
      // for it.
      subtitle?: string;
      date?: string;
      entity?: string;
      /** The sidecar's basename, present only when one was actually found
       *  and used for this document — never for "no sidecar" or
       *  `--no-config`. Per the design's own rule ("a sidecar that was used
       *  must be named in the output"), which applies to `inspect` too:
       *  a preview that silently used a sidecar is exactly the kind of
       *  invisible decision the sidecar itself exists to prevent. */
      config?: string;
      counts: Counts;
      /** Exactly what the ingester returned — not re-derived or re-worded.
       *  The ingesters own this vocabulary; a second phrasing of the same
       *  loss here is how the two would drift, which is the one thing the
       *  design explicitly rules out. */
      dropped: string[];
      warnings: string[];
    }
  | { file: string; status: 'refused'; reason: string; dropped: string[]; config?: string }
  | { file: string; status: 'failed'; reason: string };

export type InspectResult = {
  /** The theme id the width warning (and nothing else) was computed against
   *  for documents with no sidecar theme of their own — see
   *  computeWarnings' own comment on why a table-width warning needs page
   *  geometry at all. For a single-file run this is the theme actually
   *  resolved for that input (flag, then a sidecar, then "plain"); for a
   *  directory batch it is the flag-or-default theme used to walk the
   *  directory, since a sidecar is not read until the walk that finds it
   *  has already run — the same gap discoverInputs' own comment documents. */
  theme: string;
  documents: DocInspection[];
};

function emptyCounts(): Counts {
  return {
    headings: 0, paragraphs: 0, lists: 0, tables: 0, heatmaps: 0, images: 0, code: 0, quotes: 0, rules: 0, pagebreaks: 0,
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
      case 'heatmap': c.heatmaps++; break;
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

  // render/docx.ts's own exported predicate answers "can this be embedded",
  // imported rather than re-implemented — the design's own "read once" rule
  // for what an ingester returns applies just as much to what a renderer
  // will accept, and a regex duplicated here could silently go stale the
  // day that renderer answers the question a different way (see
  // canEmbedInDocx's own comment). Anything it rejects draws a bordered
  // placeholder instead, a named residual of that renderer's own docs. This
  // is deliberately not conditioned on which formats the caller intends to
  // build: DOCX is always one of the formats `build --to` can be asked for,
  // so the warning holds regardless of --theme or a future --to on inspect.
  let imageIndex = 0;
  for (const b of doc.blocks) {
    if (b.t !== 'image') continue;
    imageIndex++;
    if (!canEmbedInDocx(b.src)) {
      warnings.push(`image ${imageIndex} will not embed in Word — PNG, JPEG, GIF and BMP embed; a .docx build will draw a placeholder instead`);
    }
  }

  return warnings;
}

/**
 * Ingests, validates, and — only if both succeed — counts and inspects,
 * against a configuration already fully resolved by the caller (flag,
 * sidecar, and default all folded together — see runInspect's own two
 * callers of this function for why resolution itself happens outside it).
 * The three status branches below are exactly the three outcomes the
 * report commits to; see DocInspection's own doc comment for how each maps
 * to an exit code.
 */
async function inspectCore(
  file: string, ext: '.docx' | '.xlsx' | '.md' | '.markdown', theme: Theme, opts: IngestOpts, sidecarPath: string | undefined,
): Promise<DocInspection> {
  const config = sidecarPath === undefined ? {} : { config: basename(sidecarPath) };
  let doc: Doc;
  let dropped: string[];
  try {
    ({ doc, dropped } = await ingest(ext, file, opts));
  } catch (e) {
    return { file, status: 'failed', reason: (e as Error).message };
  }
  try {
    validateDoc(doc);
  } catch (e) {
    return { file, status: 'refused', reason: (e as Error).message, dropped, ...config };
  }
  return {
    file,
    status: 'ok',
    title: doc.meta.title,
    ...(doc.meta.subtitle === undefined ? {} : { subtitle: doc.meta.subtitle }),
    ...(doc.meta.date === undefined ? {} : { date: doc.meta.date }),
    ...(doc.meta.entity === undefined ? {} : { entity: doc.meta.entity }),
    ...config,
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
  { key: 'heatmaps', one: 'heatmap', many: 'heatmaps' },
  { key: 'images', one: 'image', many: 'images' },
  { key: 'code', one: 'code block', many: 'code blocks' },
  { key: 'quotes', one: 'quote', many: 'quotes' },
  { key: 'rules', one: 'rule', many: 'rules' },
  { key: 'pagebreaks', one: 'page break', many: 'page breaks' },
];

/** Renders one `ok` document's `understood:` line. Every word here is
 *  derived from fields already on `DocInspection`, never invented — the
 *  parity test walks this same structure at runtime to check that, rather
 *  than a hand-written list of "the fields this function remembers to
 *  render" that a new field could silently fall outside of. */
function renderUnderstood(d: Extract<DocInspection, { status: 'ok' }>): string {
  const parts: string[] = [d.title === 'Untitled' ? 'no title' : `title "${d.title}"`];
  if (d.subtitle !== undefined) parts.push(`subtitle "${d.subtitle}"`);
  if (d.date !== undefined) parts.push(`date "${d.date}"`);
  if (d.entity !== undefined) parts.push(`entity "${d.entity}"`);
  for (const { key, one, many } of COUNT_LABELS) {
    const n = d.counts[key];
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  }
  return parts.join(', ');
}

function renderOneHuman(d: DocInspection): string[] {
  const lines: string[] = [];
  if (d.status !== 'failed' && d.config !== undefined) lines.push(`  config:     ${d.config}`);
  if (d.status === 'failed') {
    lines.push(`  failed: ${d.reason}`);
    return lines;
  }
  if (d.status === 'refused') {
    lines.push(`  refused: ${d.reason}`);
    lines.push(d.dropped.length ? `  dropped:    ${d.dropped.join('; ')}` : '  dropped:    nothing');
    return lines;
  }
  lines.push(`  understood: ${renderUnderstood(d)}`);
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
  input?: string; theme?: string; json: boolean; recursive: boolean; title?: string; date?: string; entity?: string;
  config?: string; noConfig: boolean;
} {
  const out: {
    input?: string; theme?: string; json: boolean; recursive: boolean; title?: string; date?: string; entity?: string;
    config?: string; noConfig: boolean;
  } = {
    json: false, recursive: false, noConfig: false,
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
    // Same spelling, same semantics as build.ts's own --title/--date/
    // --entity (see parseArgs there) — not a second convention for the same
    // flag. See DocInspection's own comment on why inspect needs these at
    // all: it is the one place a caller can preview what `build --title`/
    // `--date`/`--entity` would actually print before running `build`.
    // --title matters most for a .docx input: that ingester has no title in
    // the body at all (unlike Markdown's h1), so without this flag
    // `inspect report.docx` and `build report.docx --title "…"` would name
    // two different titles for the same input — the same disagreement
    // --date closed for a scanned header date.
    else if (a === '--title') out.title = next();
    else if (a === '--date') out.date = next();
    else if (a === '--entity') out.entity = next();
    // Same spelling, same semantics, same precedence as build.ts's own
    // --config/--no-config — see config.ts's own resolveConfig, the one
    // function both commands call to answer "what does this input's
    // configuration resolve to".
    else if (a === '--config') out.config = next();
    else if (a === '--no-config') out.noConfig = true;
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else if (out.input === undefined) out.input = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (out.config !== undefined && out.noConfig) {
    throw new Error('--config and --no-config cannot both be given');
  }
  return out;
}

/** Same conditional-spread construction build.ts's own configFlagsFrom
 *  does, kept as inspect's own copy rather than shared: the two commands'
 *  parsed-args shapes differ (no --to/--plain-names here), so there is no
 *  single function that could serve both without also taking a shape
 *  neither owns more of than the other. */
function configFlagsFrom(args: ReturnType<typeof parseInspectArgs>): ConfigFlags {
  return {
    noConfig: args.noConfig,
    ...(args.config === undefined ? {} : { configPath: args.config }),
    ...(args.title === undefined ? {} : { title: args.title }),
    ...(args.date === undefined ? {} : { date: args.date }),
    ...(args.entity === undefined ? {} : { entity: args.entity }),
    ...(args.theme === undefined ? {} : { theme: args.theme }),
  };
}

/**
 * Exit codes. Deliberately the same four codes `build` uses, for the same
 * reasons (see the contract in src/bin/documentor.ts) — a script that
 * already knows what 0/1/2/3 mean from `build` does not have to learn a
 * second vocabulary for `inspect`:
 *   0  every document inspected read cleanly (an `ok` batch of one or many)
 *   1  something could not be read at all — a bad option value aside, this
 *      is the same "uncaught throw" class `build` reports as 1: a missing
 *      file, a corrupt zip, an unreadable subdirectory in a batch, or (in a
 *      batch) one input's own sidecar that did not resolve
 *   2  usage error — no input, an extension neither ingester reads, a
 *      sidecar that does not resolve for a *single-file* run (bad JSON, an
 *      unknown key, a --config file that does not exist — see config.ts's
 *      own resolveConfig), --config against a directory, or (for a
 *      directory) nothing readable found at all; the command as typed
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
    io.err('documentor: inspect needs an input file or directory\n\n  documentor inspect <file|dir> [--theme plain] [--json] [--recursive] [--title <s>] [--date <s>] [--entity <s>] [--config <file>] [--no-config]');
    return 2;
  }

  const inputArg = resolve(args.input);
  const inputStat = await stat(inputArg).catch(() => undefined);

  let documents: DocInspection[];
  let batchFailed = false;
  let reportedTheme: string;

  if (inputStat?.isDirectory()) {
    // Same contradiction build.ts's own runBuild refuses, for the same
    // reason: --config names one file, and a directory batch has no single
    // document for it to describe.
    if (args.config !== undefined) {
      io.err(`documentor: --config names one sidecar file, but ${inputArg} is a directory — one explicit file cannot describe every document in a batch. Drop --config (each input's own <stem>.documentor.json is found automatically beside it), or point both --config and the input at a single file.`);
      return 2;
    }
    const discoveryTheme = await loadTheme(args.theme ?? DEFAULT_THEME);
    reportedTheme = discoveryTheme.id;
    const discovered = await discoverInputs(inputArg, args.recursive, discoveryTheme.id);
    if (discovered.inputs.length === 0) {
      io.err(`documentor: no readable input under ${inputArg} (looked for ${[...READABLE_EXTS].join(', ')}${args.recursive ? ', recursively' : ''})`);
      return 2;
    }
    documents = [];
    for (const file of discovered.inputs) {
      const ext = extname(file).toLowerCase() as '.md' | '.markdown' | '.docx' | '.xlsx';
      try {
        const resolved = await resolveConfig(file, configFlagsFrom(args));
        // inspect has no --to flag of its own to validate a format against,
        // but a sidecar can still carry a `to` this build cannot write —
        // checked here, through the exact function build.ts's own runBuild
        // checks a resolved `to` with, so `inspect` cannot report a clean
        // preview for a document `build` is about to refuse (see this
        // file's own module comment on why that disagreement is precisely
        // the defect `inspect` exists to prevent).
        const formatCheck = checkFormats(resolved.to);
        if ('error' in formatCheck) throw new Error(formatCheck.error);
        const theme = await loadTheme(resolved.theme);
        documents.push(await inspectCore(file, ext, theme, resolved.ingestOpts, resolved.sidecarPath));
      } catch (e) {
        // A sidecar that does not resolve (a theme or format it names that
        // does not exist) means this one document was never read at all —
        // the same class of loss an unreadable .docx zip already is, folded
        // into 'failed' rather than aborting the batch. See DocInspection's
        // own comment on why this differs from the single-file case below.
        documents.push({ file, status: 'failed', reason: (e as Error).message });
      }
    }
    batchFailed = discovered.unreadableDirs.length > 0;
  } else {
    const ext = extname(inputArg).toLowerCase();
    if (ext !== '.md' && ext !== '.markdown' && ext !== '.docx' && ext !== '.xlsx') {
      io.err(`documentor: cannot read ${ext || 'a file with no extension'} yet — inspect reads .md, .docx and .xlsx`);
      return 2;
    }
    // A single-file run treats a sidecar that does not resolve as a usage
    // error (exit 2), the same way build.ts's own runBuild does: the fix is
    // to correct what the operator wrote, not something a batch's
    // per-document resilience should paper over for the one document the
    // caller actually asked about.
    let resolved;
    try {
      resolved = await resolveConfig(inputArg, configFlagsFrom(args));
    } catch (e) {
      io.err(`documentor: ${(e as Error).message}`);
      return 2;
    }
    // Same reasoning as the batch branch above: a sidecar's `to` is
    // validated here, through build.ts's own `checkFormats`, so a single
    // `inspect` run cannot green-light a `build` that is about to exit 2.
    const formatCheck = checkFormats(resolved.to);
    if ('error' in formatCheck) {
      io.err(`documentor: ${formatCheck.error}`);
      return 2;
    }
    const theme = await loadTheme(resolved.theme);
    reportedTheme = theme.id;
    documents = [await inspectCore(inputArg, ext, theme, resolved.ingestOpts, resolved.sidecarPath)];
  }

  const result: InspectResult = { theme: reportedTheme, documents };
  io.log(args.json ? JSON.stringify(result, null, 2) : renderHuman(result));

  if (batchFailed || documents.some((d) => d.status === 'failed')) return 1;
  if (documents.some((d) => d.status === 'refused')) return 3;
  return 0;
}
