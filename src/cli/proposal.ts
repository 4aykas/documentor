// `documentor proposal` — assemble a commercial offer from a data file and a
// template, then render it through the same pipeline `build` uses. The
// boundary this command lives behind: it assembles, it does not write — every
// sentence comes from the data file or the template, and a missing piece is
// an error naming what is missing, never invented text.
//
// No sidecar: the data file *is* the decisions file.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { assembleProposal } from '../proposal/assemble.js';
import { readProposalData } from '../proposal/data.js';
import { ProposalError } from '../proposal/types.js';
import { validateDoc, type Doc } from '../ir/validate.js';
import { renderMarkdown } from '../render/md.js';
import { renderPdf } from '../render/pdf.js';
import { renderDocx } from '../render/docx.js';
import { loadTheme, type Theme } from '../theme/resolve.js';
import { checkFormats, FORMATS, type Format } from './build.js';
import { DEFAULT_THEME } from './config.js';
import { resolveEpoch } from './timestamp.js';

type Io = { log: (s: string) => void; err: (s: string) => void };

const USAGE_LINE = `  documentor proposal <data.json> [--to ${[...FORMATS].join(',')}] [--theme plain] [--out <dir>]`;

/** The same exhaustive switch build.ts keeps as its own `renderTo` — that one
 *  is module-private, and sharing it would thread a Browser parameter through
 *  an export for no caller but this. The `never` default keeps the two in
 *  step: a format added to FORMATS breaks both files until both render it. */
async function renderTo(format: Format, doc: Doc, theme: Theme, epochSeconds: number, browser?: Browser): Promise<Buffer> {
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

function parseArgs(argv: string[]): { input?: string; to?: string[]; theme?: string; out?: string } {
  const out: { input?: string; to?: string[]; theme?: string; out?: string } = {};
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
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else if (out.input === undefined) out.input = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  return out;
}

/** Reads the data file and everything it names, all paths relative to the
 *  data file's own directory. Exported for Task 11's inspect path, which must
 *  read exactly what this build would read. */
export async function loadProposal(input: string): Promise<{
  data: ReturnType<typeof readProposalData>['data'];
  warnings: string[];
  template: string;
  annex?: Buffer;
}> {
  const dataText = await readFile(input, 'utf8').catch((e: Error) => {
    throw new ProposalError([`cannot read ${input}: ${e.message}`]);
  });
  const { data, warnings } = readProposalData(dataText);
  const base = dirname(input);
  const templatePath = resolve(base, data.template);
  const template = await readFile(templatePath, 'utf8').catch((e: Error) => {
    throw new ProposalError([`cannot read the template ${templatePath}: ${e.message}`]);
  });
  let annex: Buffer | undefined;
  if (data.annex !== undefined) {
    const annexPath = resolve(base, data.annex);
    annex = await readFile(annexPath).catch((e: Error) => {
      throw new ProposalError([`cannot read the annex ${annexPath}: ${e.message}`]);
    });
  }
  return { data, warnings, template, ...(annex === undefined ? {} : { annex }) };
}

/** The output stem: `ber01.proposal.json` → `ber01`, `offer.json` → `offer`.
 *  The `.proposal` marker is the data file's own naming convention, not the
 *  document's name, so it does not survive into the output. */
export function proposalStem(input: string): string {
  return basename(input, extname(input)).replace(/\.proposal$/, '');
}

export async function runProposal(argv: string[], io: Io): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv);
  } catch (e) {
    io.err(`documentor: ${(e as Error).message}`);
    return 2;
  }
  if (args.input === undefined) {
    io.err(`documentor: proposal needs a data file\n\n${USAGE_LINE}`);
    return 2;
  }
  const input = resolve(args.input);
  if (extname(input).toLowerCase() !== '.json') {
    io.err(`documentor: proposal reads a .json data file, got ${extname(input) || 'a file with no extension'}`);
    return 2;
  }
  const formatCheck = checkFormats(args.to ?? ['pdf']);
  if ('error' in formatCheck) {
    io.err(`documentor: ${formatCheck.error}`);
    return 2;
  }
  const formats = formatCheck;

  let doc: Doc;
  let dropped: string[];
  try {
    const loaded = await loadProposal(input);
    for (const w of loaded.warnings) io.err(`documentor: warning — ${w}`);
    ({ doc, dropped } = await assembleProposal({
      data: loaded.data, template: loaded.template,
      ...(loaded.annex === undefined ? {} : { annex: loaded.annex }),
    }));
  } catch (e) {
    if (e instanceof ProposalError) {
      io.err(`documentor: the proposal cannot be assembled — ${e.errors.length} problem(s):`);
      for (const msg of e.errors) io.err(`  - ${msg}`);
      return 2;
    }
    throw e;
  }

  try {
    validateDoc(doc);
  } catch (e) {
    io.err(`documentor: refusing to render — ${(e as Error).message}`);
    return 3; // refused — see the exit code contract in src/bin/documentor.ts
  }

  if (dropped.length) {
    io.err(`documentor: ${dropped.length} thing(s) the document format cannot hold were left out:`);
    for (const d of dropped) io.err(`  - ${d}`);
  }

  const theme = await loadTheme(args.theme ?? DEFAULT_THEME);
  const epochSeconds = await resolveEpoch(process.env, input);
  const dir = args.out === undefined ? dirname(input) : resolve(args.out);
  await mkdir(dir, { recursive: true });
  const stem = proposalStem(input);

  const needsBrowser = formats.includes('pdf');
  const browser = needsBrowser ? await chromium.launch() : undefined;
  let refused = false;
  try {
    for (const format of formats) {
      const target = join(dir, `${stem}.${theme.id}.${format}`);
      if (resolve(target) === input) {
        io.err(`documentor: refusing to overwrite the input file ${input}`);
        refused = true;
        continue;
      }
      const bytes = await renderTo(format, doc, theme, epochSeconds, browser);
      await writeFile(target, bytes);
      io.log(`${target}  (${bytes.length.toLocaleString('en-US')} bytes)`);
    }
  } finally {
    if (browser !== undefined) await browser.close();
  }
  return refused ? 3 : 0;
}
