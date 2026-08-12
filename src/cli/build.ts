import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { ingestMarkdown } from '../ingest/md.js';
import { renderMarkdown } from '../render/md.js';
import { renderPdf } from '../render/pdf.js';
import { loadTheme } from '../theme/resolve.js';
import { resolveEpoch } from './timestamp.js';

type Io = { log: (s: string) => void; err: (s: string) => void };
const FORMATS = new Set(['pdf', 'md']); // phase 1; docx and xlsx arrive in phases 2 and 3

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
    io.err('documentor: build needs an input file\n\n  documentor build <file> [--to pdf,md] [--theme plain] [--out <dir>]');
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
    if (resolve(target) === input) {
      io.err(`documentor: refusing to overwrite the input file ${input}`);
      return 1;
    }
    const bytes = format === 'pdf'
      ? await renderPdf(doc, theme, { epochSeconds })
      : Buffer.from(renderMarkdown(doc), 'utf8');
    await writeFile(target, bytes);
    io.log(`${target}  (${bytes.length.toLocaleString('en-US')} bytes)`);
  }
  return 0;
}
