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

type Discovered = {
  inputs: string[];
  // Filtered out as this build's own prior output (see the theme-id-marker
  // comment below), not silently — a real source that happens to be named
  // e.g. `contract.plain.md` would otherwise vanish from a run with no
  // trace at all, which is exactly the kind of loss this batch's summary
  // exists to surface. Named here so runBuildBatch can report a count.
  skippedOwnOutput: string[];
  // A directory readdir refused (permissions, a broken junction, …) does not
  // abort the walk — its siblings are still walked, and it is reported
  // rather than silently missing from the batch, the same property
  // processFile already protects for a single bad document.
  unreadableDirs: { dir: string; reason: string }[];
};

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
 * all. What this does *not* catch, on purpose rather than by oversight: a
 * file from a run under a *different* theme id carries no marker this scan
 * recognises, and is left open — narrowing it would mean guessing at every
 * string that might be a theme id, which is worse than an honest gap. A
 * `--plain-names` output writing `md` or `docx` (identical name to a real
 * source, no marker at all) is closed a different way: runBuildBatch refuses
 * that combination outright rather than relying on a filename heuristic that
 * cannot see it.
 */
async function discoverInputs(dir: string, recursive: boolean, themeId: string): Promise<Discovered> {
  const inputs: string[] = [];
  const skippedOwnOutput: string[] = [];
  const unreadableDirs: { dir: string; reason: string }[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch (e) {
      unreadableDirs.push({ dir: d, reason: (e as Error).message });
      return; // this directory's contents are unknown; siblings are still walked
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = join(d, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        // A symlinked .md is an ordinary input from the operator's chair —
        // readdir's Dirent flags describe the link itself, not what it
        // points to, so a symlink would otherwise be silently treated as
        // "not a document" regardless of its target. Resolved once via
        // `stat` (which follows the link) instead. Not guarded: a symlink
        // cycle under --recursive, since nothing in this project's real
        // usage (a data room, a delivery folder) has ever produced one.
        const target = await stat(full).catch(() => undefined);
        isDir = target?.isDirectory() ?? false;
        isFile = target?.isFile() ?? false;
      }
      if (isDir) {
        if (recursive) await walk(full);
        continue;
      }
      if (!isFile) continue; // a broken symlink, socket, fifo, … — genuinely not a document
      const ext = extname(entry.name).toLowerCase();
      if (!READABLE_EXTS.has(ext)) continue;
      const stem = basename(entry.name, ext);
      if (stem.endsWith(`.${themeId}`)) { skippedOwnOutput.push(full); continue; }
      inputs.push(full);
    }
  }
  await walk(dir);
  return { inputs, skippedOwnOutput, unreadableDirs };
}

/** Where a document's outputs land, and what to call them — the one
 * computation collision-detection and processFile must agree on, since a
 * collision the pre-pass didn't see is a collision the write loop would
 * silently commit. */
function targetsFor(
  input: string, args: ReturnType<typeof parseArgs>, formats: readonly Format[], theme: Theme,
): { outDir: string; targets: string[] } {
  const outDir = args.out === undefined ? dirname(input) : resolve(args.out);
  const stem = basename(input, extname(input));
  const targets = formats.map((format) =>
    resolve(join(outDir, args.plainNames ? `${stem}.${format}` : `${stem}.${theme.id}.${format}`)));
  return { outDir, targets };
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
  input: string, args: ReturnType<typeof parseArgs>, formats: Format[], theme: Theme, browser: Browser | undefined,
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

    // Same computation runBuildBatch's collision pre-pass already ran over
    // every file before any of them reached this function — recomputed
    // rather than threaded through as a parameter so this function stays
    // the single source of truth for "what does this input's output path
    // look like", with the pre-pass calling out to it instead of the other
    // way around.
    const { outDir, targets } = targetsFor(input, args, formats, theme);
    await mkdir(outDir, { recursive: true });
    const written: string[] = [];
    let refusedReason: string | undefined;
    for (const [i, format] of formats.entries()) {
      const target = targets[i]!;
      if (target === resolve(input)) {
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
function printSummary(
  results: readonly FileResult[], discovered: Discovered, outDir: string | undefined, io: Io,
): void {
  // Every bucket below is disjoint — each result lands in exactly one — so
  // these counts can be printed independently without one silently
  // including entries another already counted. A `refused` result that
  // still wrote some formats used to be counted in both "written" and
  // "refused" at once, which let the total exceed the number of documents;
  // it now has its own line instead of hiding inside "written".
  const fullyWritten = results.filter((r): r is Extract<FileResult, { kind: 'written' }> => r.kind === 'written');
  const refused = results.filter((r): r is Extract<FileResult, { kind: 'refused' }> => r.kind === 'refused');
  const partial = refused.filter((r) => r.written.length > 0);
  const refusedOnly = refused.filter((r) => r.written.length === 0);
  const failed = results.filter((r): r is Extract<FileResult, { kind: 'failed' }> => r.kind === 'failed');

  io.log('');
  io.log(`documentor: batch summary — ${results.length} document(s)`);
  io.log(`  ${fullyWritten.length} written`);
  if (partial.length) {
    io.log(`  ${partial.length} partially written (one or more formats refused):`);
    for (const r of partial) io.log(`    - ${basename(r.input)}: ${r.reason}`);
  }
  if (refusedOnly.length) {
    io.log(`  ${refusedOnly.length} refused:`);
    for (const r of refusedOnly) io.log(`    - ${basename(r.input)}: ${r.reason}`);
  }
  if (failed.length) {
    io.log(`  ${failed.length} failed:`);
    for (const r of failed) io.log(`    - ${basename(r.input)}: ${r.reason}`);
  }

  // The path, not just a count: with --out sending output away from the
  // inputs, "12 written" alone doesn't say where they landed, and 84 files
  // is too many to infer from the per-file lines above (which this summary
  // exists to replace anyway). Without --out, output is scattered beside
  // each input rather than one place, so there is no single directory to
  // name — the count still says something on its own there.
  const totalWritten = fullyWritten.reduce((n, r) => n + r.written.length, 0)
    + partial.reduce((n, r) => n + r.written.length, 0);
  io.log(outDir === undefined
    ? `  wrote ${totalWritten} file(s) beside their inputs`
    : `  wrote ${totalWritten} file(s) to ${outDir}`);

  if (discovered.skippedOwnOutput.length) {
    io.log(`  ${discovered.skippedOwnOutput.length} skipped as this build's own prior output:`);
    for (const p of discovered.skippedOwnOutput) io.log(`    - ${basename(p)}`);
  }
  if (discovered.unreadableDirs.length) {
    io.log(`  ${discovered.unreadableDirs.length} director(y/ies) could not be read:`);
    for (const u of discovered.unreadableDirs) io.log(`    - ${u.dir}: ${u.reason}`);
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
  // no filename heuristic can tell them apart on a rerun. That gap is real
  // only when the output can land back inside the tree this run itself
  // scans — i.e. no --out, since output then defaults to beside each input.
  // An --out pointed elsewhere genuinely closes it (the next scan of `dir`
  // never looks in --out's directory), so the condition checks for that
  // rather than blocking every --plain-names batch and then telling the
  // user to do the one thing (`--out`) that would have been safe.
  if (args.plainNames && args.out === undefined && formats.some((f) => f === 'md' || f === 'docx')) {
    io.err('documentor: --plain-names is refused for a directory batch writing md or docx with no --out — both are also readable input extensions, so a rerun over this folder could not tell this run\'s own output from a fresh source document; drop --plain-names, or pass --out to write outside this folder');
    return 2;
  }

  const discovered = await discoverInputs(dir, args.recursive, theme.id);
  const files = discovered.inputs;
  if (files.length === 0) {
    io.err(`documentor: no readable input under ${dir} (looked for .md, .markdown, .docx${args.recursive ? ', recursively' : ''})`);
    return 2;
  }

  const outDir = args.out === undefined ? undefined : resolve(args.out);
  const results: FileResult[] = [];

  // Every target this run would write, computed for every file before any
  // of them is ingested or rendered. This is the fix for the batch's worst
  // failure mode: two sources that collapse to the same
  // `<stem>.<theme>.<format>` (a name derived from the stem alone, which
  // drops both the source extension and, with --out, the source directory)
  // used to overwrite each other with no warning, and the summary counted
  // both as written even though only one file's bytes survived on disk.
  // Refusing both sides of a collision — rather than picking one to
  // disambiguate with an invented suffix — is the same policy the
  // single-file overwrite guard already uses: predictable, and it never
  // requires guessing which of two documents the operator actually wanted
  // at that name.
  const bySources = new Map<string, string[]>(); // resolved target -> every input that would write it
  for (const file of files) {
    const { targets } = targetsFor(file, args, formats, theme);
    for (const target of targets) {
      const list = bySources.get(target) ?? [];
      list.push(file);
      bySources.set(target, list);
    }
  }
  const collidesWith = new Map<string, Set<string>>(); // input -> the other input(s) it collides with
  for (const sources of bySources.values()) {
    const unique = [...new Set(sources)];
    if (unique.length < 2) continue;
    for (const s of unique) {
      const set = collidesWith.get(s) ?? new Set<string>();
      for (const other of unique) if (other !== s) set.add(other);
      collidesWith.set(s, set);
    }
  }

  // Only launched when a requested format actually needs Chromium — a
  // directory of .md/.docx sources written --to md or --to docx has no
  // reason to carry Playwright's browser dependency at all (measured:
  // launch=1, newPage=0 before this fix), and a batch that omits pdf
  // should not fail with an "install chromium" message a single-file build
  // of the same input would never have hit.
  const needsBrowser = formats.includes('pdf');
  const browser = needsBrowser ? await chromium.launch() : undefined;
  try {
    for (const file of files) {
      const collision = collidesWith.get(file);
      if (collision !== undefined) {
        const reason = `output target collides with ${[...collision].map((o) => basename(o)).join(', ')} — both would write the same file, so neither was written`;
        results.push({ input: file, kind: 'refused', written: [], dropped: [], reason });
        io.err(`documentor: ${file} — refused: ${reason}`);
        continue;
      }
      const result = await processFile(file, args, formats, theme, browser);
      results.push(result);
      if (result.kind === 'failed') io.err(`documentor: ${file} — failed: ${result.reason}`);
      else if (result.kind === 'refused') io.err(`documentor: ${file} — refused: ${result.reason}`);
    }
  } finally {
    if (browser !== undefined) await browser.close();
  }

  printSummary(results, discovered, outDir, io);

  // 1 outranks 3 outranks 0: a `failed` entry is the batch's analogue of the
  // single-file body's uncaught throw (exit 1, "a bug, a missing file,
  // etc." — nothing this build could have told the caller in advance), while
  // `refused` is its analogue of the validateDoc/overwrite refusal (exit 3,
  // "understood and declined, do not retry unchanged"). A batch with both
  // reports the more serious class, the same way a single build never gets
  // to choose between 1 and 3 for the one document it ran. An unreadable
  // subdirectory is folded into the `failed` class: like a failed document,
  // it means part of the batch's own intended input was never even seen,
  // which is strictly worse than a document this build read and declined.
  if (results.some((r) => r.kind === 'failed') || discovered.unreadableDirs.length > 0) return 1;
  if (results.some((r) => r.kind === 'refused')) return 3;
  return 0;
}
