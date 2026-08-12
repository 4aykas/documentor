import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { ingestMarkdown } from '../ingest/md.js';
import { ingestDocx } from '../ingest/docx.js';
import type { Ingested } from '../ir/types.js';
import { validateDoc, type Doc } from '../ir/validate.js';
import { renderMarkdown } from '../render/md.js';
import { renderPdf } from '../render/pdf.js';
import { renderDocx } from '../render/docx.js';
import { loadTheme, type Theme } from '../theme/resolve.js';
import { resolveEpoch } from './timestamp.js';

type Io = { log: (s: string) => void; err: (s: string) => void };
// Exported so the top-level --help text can name exactly what this build
// accepts, rather than carrying its own copy that can drift out of sync.
const FORMAT_LIST = ['pdf', 'md', 'docx'] as const; // xlsx arrives in phase 3
export type Format = (typeof FORMAT_LIST)[number];
export const FORMATS: ReadonlySet<Format> = new Set(FORMAT_LIST);

/** Narrows a user-supplied string to a format this build actually renders. */
function isFormat(s: string): s is Format {
  return (FORMATS as ReadonlySet<string>).has(s);
}

/**
 * Format → bytes, as an exhaustive switch over a union rather than a `?:`
 * chain with a Markdown tail.
 *
 * The shape matters more than the code. A chain's last branch claims every
 * format the earlier ones did not, so adding a format to FORMAT_LIST without
 * adding a branch here compiled clean, ran clean, exited 0, and wrote Markdown
 * bytes into a file carrying the new extension — the worst kind of wrong
 * answer, because the file opens. The `never` binding below makes that a
 * compile error instead: the day `xlsx` joins the list, this stops building
 * until someone renders it.
 */
// `browser`, when supplied, is threaded straight into renderPdf so a batch
// can hand it one Chromium for every document instead of paying a launch
// per file — renderPdf already accepts a caller-supplied browser for exactly
// this. Omitted (not `undefined`, per exactOptionalPropertyTypes) for the
// single-file path, which keeps launching its own — unchanged from before
// batching existed, since a single build launching once was never the cost
// this exists to cut.
async function renderTo(
  format: Format, doc: Doc, theme: Theme, epochSeconds: number, browser?: Browser,
): Promise<Buffer> {
  switch (format) {
    case 'pdf': return renderPdf(doc, theme, { epochSeconds, ...(browser === undefined ? {} : { browser }) });
    case 'docx': return renderDocx(doc, theme, { epochSeconds });
    case 'md': return Buffer.from(renderMarkdown(doc), 'utf8');
    default: {
      const unhandled: never = format;
      throw new Error(`no renderer for format ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * One spot for "which ingester, read how". Both ingesters return the same
 * `{ doc, dropped }` shape, so everything after this call is format-agnostic
 * — the code downstream never learns which branch ran.
 *
 * The read mode is not a separate decision from the ingester choice: a .docx
 * is a zip, and `readFile(input, 'utf8')` would corrupt it into replacement
 * characters before ingestDocx ever saw the bytes. Deciding both together,
 * here, is what keeps that pairing from drifting apart later.
 */
async function ingest(
  ext: '.docx' | '.md' | '.markdown', input: string, args: ReturnType<typeof parseArgs>,
): Promise<Ingested> {
  const opts = {
    ...(args.title === undefined ? {} : { title: args.title }),
    ...(args.date === undefined ? {} : { date: args.date }),
    ...(args.entity === undefined ? {} : { entity: args.entity }),
  };
  if (ext === '.docx') {
    const bytes = await readFile(input);
    const result = await ingestDocx(bytes, opts);
    // ingestDocx has no way to know the file it came from — it falls back to
    // the literal string "Untitled" when neither --title nor a body DocTitle
    // supplied one (see its own "falls back to Untitled" test). The design
    // doc's rule is that a DOCX's name is its title in that case, so this is
    // the one place that can fill it in: --title and a body title (checked
    // above, inside ingestDocx, in that order) both still win over it.
    if (args.title === undefined && result.doc.meta.title === 'Untitled') {
      result.doc.meta.title = basename(input, ext);
    }
    return result;
  }
  const source = await readFile(input, 'utf8');
  return ingestMarkdown(source, opts);
}

export function parseArgs(argv: string[]): {
  input?: string; to: string[]; theme: string; out?: string; title?: string; date?: string; entity?: string;
  plainNames: boolean; recursive: boolean;
} {
  const out: {
    input?: string; to: string[]; theme: string; out?: string; title?: string; date?: string; entity?: string;
    plainNames: boolean; recursive: boolean;
  } = {
    to: ['pdf'], theme: 'plain', plainNames: false, recursive: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--to') out.to = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--theme') out.theme = next();
    else if (a === '--out') out.out = next();
    else if (a === '--title') out.title = next();
    // --date is carried verbatim into meta.date, never parsed: it is what the
    // document says about itself (e.g. a re-issued file's old letterhead read
    // "July 20, 2026"), not a machine date, and this is not SOURCE_DATE_EPOCH
    // — that controls file timestamps for reproducibility, this controls what
    // the printed page says.
    else if (a === '--date') out.date = next();
    else if (a === '--entity') out.entity = next();
    // Opt-out of the theme id in the output name. The id is there so a
    // same-extension re-issue (report.pdf --to pdf) can never collide with
    // its own input; dropping it for a batch of .md/.docx sources being
    // reissued as PDF just removes noise from every filename, since nothing
    // in that batch can collide anyway. The overwrite guard below still runs
    // either way, so the one case where dropping the id *would* collide is
    // still caught, not silently allowed.
    else if (a === '--plain-names') out.plainNames = true;
    // Off by default. A data room is nested and a flat delivery folder is
    // not, and there is no way to tell which one a bare directory argument
    // means — so this picks the conservative reading: a directory argument
    // is its own top level only, the same way `cp` and `ls` don't descend
    // without `-r`. The alternative default (always recurse) would walk
    // into an `--out` subfolder from a previous batch, or an unrelated
    // nested project, without being asked; opting in for the data-room case
    // costs one flag, opting out of an unwanted descent costs a rerun.
    else if (a === '--recursive') out.recursive = true;
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else if (out.input === undefined) out.input = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  return out;
}

export async function runBuild(argv: string[], io: Io): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv);
  } catch (e) {
    io.err(`documentor: ${(e as Error).message}`);
    return 2;
  }
  if (args.input === undefined) {
    io.err(`documentor: build needs an input file or directory\n\n  documentor build <file|dir> [--to ${[...FORMATS].join(',')}] [--theme plain] [--out <dir>] [--title <s>] [--date <s>] [--entity <s>] [--plain-names] [--recursive]`);
    return 2;
  }
  // Narrowed here, once, so that everything downstream carries the union type
  // and the dispatch in renderTo can be checked for exhaustiveness at all.
  const formats: Format[] = [];
  for (const f of args.to) {
    if (!isFormat(f)) {
      io.err(`documentor: cannot write ${JSON.stringify(f)} yet — this build knows ${[...FORMATS].join(', ')}`);
      return 2;
    }
    formats.push(f);
  }

  // A directory argument is dispatched to its own function entirely, rather
  // than threaded through the single-file body below with branches. That
  // body is exhaustively tested single-file behaviour (byte-identical output
  // is a hard constraint); the only change it needed to accommodate batching
  // is this fork, before any of its own logic runs.
  const inputArg = resolve(args.input);
  const inputStat = await stat(inputArg).catch(() => undefined);
  if (inputStat?.isDirectory()) return runBuildBatch(inputArg, args, formats, io);

  const input = resolve(args.input);
  const ext = extname(input).toLowerCase();
  if (ext !== '.md' && ext !== '.markdown' && ext !== '.docx') {
    io.err(`documentor: cannot read ${ext || 'a file with no extension'} yet — this build reads .md and .docx`);
    return 2;
  }

  const { doc, dropped } = await ingest(ext, input, args);
  // The gate between ingest and render. Every renderer assumes a well-formed
  // Doc — an exhaustive switch over `Block` type-checks but says nothing about
  // what actually arrives at runtime from an ingester, a hand-written IR file
  // or (from phase 4) a sidecar's overrides. Checking once here means a
  // renderer never has to.
  //
  // Exit 3, "refused", not 2 and not 1. Not 2: the command as typed is
  // perfectly well formed, and there is no option the user could change to
  // make it work, so telling them to fix their usage would be a lie. Not 1:
  // nothing crashed — documentor read the document, understood it, and
  // declined to draw something it cannot vouch for. 3 is the code that says
  // "final, do not retry", which is exactly right: re-running will fail the
  // same way until the document changes.
  try {
    validateDoc(doc);
  } catch (e) {
    io.err(`documentor: refusing to render — ${(e as Error).message}`);
    return 3; // refused — see the exit code contract in src/bin/documentor.ts
  }
  const theme = await loadTheme(args.theme);
  const epochSeconds = await resolveEpoch(process.env, input);

  if (dropped.length) {
    io.err(`documentor: ${dropped.length} thing(s) the document format cannot hold were left out:`);
    for (const d of dropped) io.err(`  - ${d}`);
  }

  const dir = args.out === undefined ? dirname(input) : resolve(args.out);
  await mkdir(dir, { recursive: true });
  const stem = basename(input, extname(input));

  // Reachable now, not just an invariant assertion: with --plain-names the
  // target is "<stem>.<format>", and a same-extension re-issue (e.g.
  // `report.pdf --to pdf --plain-names`) makes that exactly the input's own
  // name. Without the flag this stays unreachable by construction — the
  // theme id is an extra path segment the resolved input can never carry —
  // so the guard is still worth keeping either way, but it can no longer be
  // dismissed as untestable.
  let refused = false;
  for (const format of formats) {
    const target = join(dir, args.plainNames ? `${stem}.${format}` : `${stem}.${theme.id}.${format}`);
    if (resolve(target) === input) {
      io.err(`documentor: refusing to overwrite the input file ${input}`);
      refused = true; // refused — see the exit code contract in src/bin/documentor.ts
      continue; // one colliding format must not stop the others from being written
    }
    const bytes = await renderTo(format, doc, theme, epochSeconds);
    await writeFile(target, bytes);
    io.log(`${target}  (${bytes.length.toLocaleString('en-US')} bytes)`);
  }
  return refused ? 3 : 0;
}

// The extensions an ingester in this project actually reads. Anything else
// found in a directory walk — PDFs, spreadsheets, images, a previous run's
// own renders under an unrecognised extension — is not noise to report, it
// is simply not an input, so discoverInputs below skips it without a word.
const READABLE_EXTS = new Set(['.md', '.markdown', '.docx']);

/**
 * Walks a directory (optionally recursive) and returns every file this build
 * can ingest, sorted by path so a batch's order — and therefore anything
 * that depends on it, like which file a same-target collision blames first —
 * does not depend on the filesystem's own, platform-specific readdir order.
 *
 * Guards the case named in the batch spec directly: running
 * `documentor build <dir> --to md` twice over the same folder. The first run
 * writes `report.plain.md` beside `report.md`; without this filter the
 * second run's directory scan would find both, and feed the first run's own
 * output back in as if it were a fresh source document. The default output
 * name always carries `.<themeId>.` before the final extension, so a file
 * whose stem ends that way is this build's own mark, not a source — skipped
 * here rather than merely skipped in the summary, so it's never ingested at
 * all. What this does *not* catch: a file from a run under a *different*
 * theme id (no marker this scan recognises), and a `--plain-names` output
 * writing `md` or `docx` (identical name to a real source) — which is why
 * runBuildBatch refuses that combination outright instead of relying on a
 * filename heuristic that cannot see it.
 */
async function discoverInputs(dir: string, recursive: boolean, themeId: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(d: string): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (recursive) await walk(full);
        continue;
      }
      if (!entry.isFile()) continue; // symlinks, sockets, etc. — not documents
      const ext = extname(entry.name).toLowerCase();
      if (!READABLE_EXTS.has(ext)) continue;
      const stem = basename(entry.name, ext);
      if (stem.endsWith(`.${themeId}`)) continue; // this build's own output — see above
      found.push(full);
    }
  }
  await walk(dir);
  return found;
}

type FileResult =
  | { input: string; kind: 'written'; written: string[]; dropped: string[] }
  | { input: string; kind: 'refused'; written: string[]; dropped: string[]; reason: string }
  | { input: string; kind: 'failed'; reason: string };

/**
 * One document's worth of the single-file body above, reshaped to return a
 * result instead of writing to `io` or returning an exit code directly — a
 * batch needs to keep going after this, and to fold the outcome into a
 * summary rather than report it in isolation. Every failure mode is caught
 * here, not left to propagate: that is what lets one unreadable or refused
 * document leave the rest of the batch untouched, which is the property
 * that makes a batch result trustworthy at all on a real folder.
 */
async function processFile(
  input: string, args: ReturnType<typeof parseArgs>, formats: Format[], theme: Theme, browser: Browser,
): Promise<FileResult> {
  try {
    const ext = extname(input).toLowerCase();
    if (ext !== '.md' && ext !== '.markdown' && ext !== '.docx') {
      // Unreachable via discoverInputs, which only ever returns these three
      // extensions — kept as a live check anyway rather than an
      // unenforced assumption, in case this function ever gets a caller
      // that doesn't go through that filter.
      throw new Error(`cannot read ${ext || 'a file with no extension'} yet — this build reads .md and .docx`);
    }
    const epochSeconds = await resolveEpoch(process.env, input);
    const { doc, dropped } = await ingest(ext, input, args);
    try {
      validateDoc(doc);
    } catch (e) {
      return { input, kind: 'refused', written: [], dropped, reason: (e as Error).message };
    }

    const outDir = args.out === undefined ? dirname(input) : resolve(args.out);
    await mkdir(outDir, { recursive: true });
    const stem = basename(input, extname(input));
    const written: string[] = [];
    let refusedReason: string | undefined;
    for (const format of formats) {
      const target = join(outDir, args.plainNames ? `${stem}.${format}` : `${stem}.${theme.id}.${format}`);
      if (resolve(target) === input) {
        refusedReason = `refusing to overwrite the input file ${input}`;
        continue; // one colliding format must not stop the others from being written
      }
      const bytes = await renderTo(format, doc, theme, epochSeconds, browser);
      await writeFile(target, bytes);
      written.push(target);
    }
    if (refusedReason !== undefined) return { input, kind: 'refused', written, dropped, reason: refusedReason };
    return { input, kind: 'written', written, dropped };
  } catch (e) {
    // Anything that threw and wasn't already turned into a result above —
    // an unreadable .docx zip, a permissions error, a disk full mid-write —
    // lands here rather than aborting the loop in runBuildBatch.
    return { input, kind: 'failed', reason: (e as Error).message };
  }
}

/**
 * Prints the summary that makes a batch trustworthy on a real folder. Three
 * things a person reading 86 lines of scroll cannot reliably do by eye:
 * count how many actually wrote, tell which ones didn't and why, and see
 * what got dropped without reading every per-file list — so this computes
 * all three instead of leaving them implicit in the log above it.
 */
function printSummary(results: readonly FileResult[], io: Io): void {
  const written = results.filter((r) => r.kind === 'written' || (r.kind === 'refused' && r.written.length > 0));
  const refused = results.filter((r) => r.kind === 'refused');
  const failed = results.filter((r) => r.kind === 'failed');

  io.log('');
  io.log(`documentor: batch summary — ${results.length} document(s)`);
  io.log(`  ${written.length} written`);
  if (refused.length) {
    io.log(`  ${refused.length} refused:`);
    for (const r of refused) io.log(`    - ${basename(r.input)}: ${r.reason}`);
  }
  if (failed.length) {
    io.log(`  ${failed.length} failed:`);
    for (const r of failed) io.log(`    - ${basename(r.input)}: ${r.reason}`);
  }

  // Grouped by *what* was left out, not repeated once per document: across a
  // real batch the same handful of unsupported constructs (raw HTML, a
  // table, an embedded image) recur across many files, and a per-file list
  // would just be the 200-line scroll this summary exists to replace. A
  // clean batch says so plainly — the point is that "nothing dropped" and
  // "40 things dropped" must not look the same at a glance.
  const byDrop = new Map<string, string[]>();
  for (const r of results) {
    if (!('dropped' in r)) continue;
    for (const d of r.dropped) {
      const docs = byDrop.get(d) ?? [];
      docs.push(basename(r.input));
      byDrop.set(d, docs);
    }
  }
  if (byDrop.size === 0) {
    io.log('  nothing dropped');
  } else {
    io.log('  dropped:');
    for (const [what, docs] of byDrop) io.log(`    - ${what}  (${docs.length}): ${docs.join(', ')}`);
  }
}

async function runBuildBatch(
  dir: string, args: ReturnType<typeof parseArgs>, formats: Format[], io: Io,
): Promise<number> {
  const theme = await loadTheme(args.theme);

  // discoverInputs' own-output guard only recognises the default naming
  // scheme (`<stem>.<themeId>.<ext>`); `--plain-names` output for a readable
  // extension (md, docx) is spelled identically to a genuine source file, so
  // no filename heuristic can tell them apart on a rerun. Refusing the
  // combination up front is what keeps that gap from silently reingesting a
  // batch's own prior output — the alternative was a footgun with no error
  // message anywhere near where it would go wrong.
  if (args.plainNames && formats.some((f) => f === 'md' || f === 'docx')) {
    io.err('documentor: --plain-names is refused for a directory batch writing md or docx — both are also readable input extensions, so a rerun over this folder could not tell this run\'s own output from a fresh source document; drop --plain-names, or send this batch elsewhere with --out');
    return 2;
  }

  const files = await discoverInputs(dir, args.recursive, theme.id);
  if (files.length === 0) {
    io.err(`documentor: no readable input under ${dir} (looked for .md, .markdown, .docx${args.recursive ? ', recursively' : ''})`);
    return 2;
  }

  // One browser for the whole batch — launched once, closed in `finally` so
  // a mid-batch throw (a bug in this loop, not a per-file failure, which
  // processFile already catches on its own) cannot leak a Chromium process.
  const browser = await chromium.launch();
  const results: FileResult[] = [];
  try {
    for (const file of files) {
      const result = await processFile(file, args, formats, theme, browser);
      results.push(result);
      if (result.kind === 'failed') io.err(`documentor: ${file} — failed: ${result.reason}`);
      else if (result.kind === 'refused') io.err(`documentor: ${file} — refused: ${result.reason}`);
    }
  } finally {
    await browser.close();
  }

  printSummary(results, io);

  // 1 outranks 3 outranks 0: a `failed` entry is the batch's analogue of the
  // single-file body's uncaught throw (exit 1, "a bug, a missing file,
  // etc." — nothing this build could have told the caller in advance), while
  // `refused` is its analogue of the validateDoc/overwrite refusal (exit 3,
  // "understood and declined, do not retry unchanged"). A batch with both
  // reports the more serious class, the same way a single build never gets
  // to choose between 1 and 3 for the one document it ran.
  if (results.some((r) => r.kind === 'failed')) return 1;
  if (results.some((r) => r.kind === 'refused')) return 3;
  return 0;
}
