import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
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
async function renderTo(
  format: Format, doc: Doc, theme: Theme, epochSeconds: number,
): Promise<Buffer> {
  switch (format) {
    case 'pdf': return renderPdf(doc, theme, { epochSeconds });
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
  plainNames: boolean;
} {
  const out: {
    input?: string; to: string[]; theme: string; out?: string; title?: string; date?: string; entity?: string;
    plainNames: boolean;
  } = {
    to: ['pdf'], theme: 'plain', plainNames: false,
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
    io.err(`documentor: build needs an input file\n\n  documentor build <file> [--to ${[...FORMATS].join(',')}] [--theme plain] [--out <dir>] [--title <s>] [--date <s>] [--entity <s>] [--plain-names]`);
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
