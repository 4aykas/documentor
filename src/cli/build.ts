import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { ingestMarkdown } from '../ingest/md.js';
import { validateDoc } from '../ir/validate.js';
import { renderMarkdown } from '../render/md.js';
import { renderPdf } from '../render/pdf.js';
import { renderDocx } from '../render/docx.js';
import { loadTheme } from '../theme/resolve.js';
import { resolveEpoch } from './timestamp.js';

type Io = { log: (s: string) => void; err: (s: string) => void };
// Exported so the top-level --help text can name exactly what this build
// accepts, rather than carrying its own copy that can drift out of sync.
export const FORMATS = new Set(['pdf', 'md', 'docx']); // xlsx arrives in phase 3

export function parseArgs(argv: string[]): {
  input?: string; to: string[]; theme: string; out?: string; title?: string;
} {
  const out: { input?: string; to: string[]; theme: string; out?: string; title?: string } = {
    to: ['pdf'], theme: 'plain',
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
    io.err(`documentor: build needs an input file\n\n  documentor build <file> [--to ${[...FORMATS].join(',')}] [--theme plain] [--out <dir>]`);
    return 2;
  }
  for (const f of args.to) {
    if (!FORMATS.has(f)) {
      io.err(`documentor: cannot write ${JSON.stringify(f)} yet — this build knows ${[...FORMATS].join(', ')}`);
      return 2;
    }
  }

  const input = resolve(args.input);
  const ext = extname(input).toLowerCase();
  if (ext !== '.md' && ext !== '.markdown') {
    io.err(`documentor: cannot read ${ext || 'a file with no extension'} yet — this build reads .md`);
    return 2;
  }

  const source = await readFile(input, 'utf8');
  const { doc, dropped } = ingestMarkdown(source, args.title === undefined ? {} : { title: args.title });
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

  for (const format of args.to) {
    const target = join(dir, `${stem}.${theme.id}.${format}`);
    // Unreachable by construction today: target is always
    // "<stem>.<theme.id>.<format>", an extra path segment the resolved input
    // can never carry, so this can never be true under the current naming
    // scheme. It stays as an invariant assertion against a future change to
    // that scheme (e.g. a theme id or format that collapses back onto the
    // input's own name) — deliberately left untested, since contriving a
    // test to reach it would just be testing today's naming scheme twice.
    if (resolve(target) === input) {
      io.err(`documentor: refusing to overwrite the input file ${input}`);
      return 3; // refused — see the exit code contract in src/bin/documentor.ts
    }
    const bytes =
      format === 'pdf' ? await renderPdf(doc, theme, { epochSeconds })
      : format === 'docx' ? await renderDocx(doc, theme, { epochSeconds })
      : Buffer.from(renderMarkdown(doc), 'utf8');
    await writeFile(target, bytes);
    io.log(`${target}  (${bytes.length.toLocaleString('en-US')} bytes)`);
  }
  return 0;
}
