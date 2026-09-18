// `documentor contract` — assemble a bilingual contract from a data file and
// the template it names, then render it through the same pipeline `build`
// and `proposal` use. The same boundary `proposal` lives behind: it
// assembles, it does not write. Every sentence comes from the data file or
// the template, and a missing piece is an error naming it, never invented
// text — which matters more here than anywhere else, because an invented
// clause is a clause nobody agreed to.
//
// No sidecar: the data file *is* the decisions file.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { assembleContract } from '../contract/assemble.js';
import { readContractData } from '../contract/data.js';
import { ContractError } from '../contract/types.js';
import { validateDoc, type Doc } from '../ir/validate.js';
import { renderMarkdown } from '../render/md.js';
import { renderPdf } from '../render/pdf.js';
import { renderDocx } from '../render/docx.js';
import { loadTheme } from '../theme/resolve.js';
import { checkFormats, FORMATS } from './build.js';
import { DEFAULT_THEME } from './config.js';
import { resolveEpoch } from './timestamp.js';

type Io = { log: (s: string) => void; err: (s: string) => void };

export const CONTRACT_USAGE_LINE = `  documentor contract <data.json> [--to ${[...FORMATS].join(',')}] [--theme plain] [--out <dir>]`;

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

/** Reads the data file and the template it names, the template path relative
 *  to the data file's own directory. */
export async function loadContract(input: string): Promise<{
  data: ReturnType<typeof readContractData>['data'];
  warnings: string[];
  template: string;
}> {
  const dataText = await readFile(input, 'utf8').catch((e: Error) => {
    throw new ContractError([`cannot read ${input}: ${e.message}`]);
  });
  const { data, warnings } = readContractData(dataText);
  const templatePath = resolve(dirname(input), data.template);
  const template = await readFile(templatePath, 'utf8').catch((e: Error) => {
    throw new ContractError([`cannot read the template ${templatePath}: ${e.message}`]);
  });
  return { data, warnings, template };
}

/** `vitsotenko.contract.json` → `vitsotenko`. The `.contract` marker is the
 *  data file's naming convention, not the document's name, so it does not
 *  survive into the output — the same rule `proposalStem` keeps. */
export function contractStem(input: string): string {
  return basename(input, extname(input)).replace(/\.contract$/i, '');
}

export async function runContract(argv: string[], io: Io): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv);
  } catch (e) {
    io.err(`documentor: ${(e as Error).message}`);
    return 2;
  }
  if (args.input === undefined) {
    io.err(`documentor: contract needs a data file\n\n${CONTRACT_USAGE_LINE}`);
    return 2;
  }
  const input = resolve(args.input);
  if (extname(input).toLowerCase() !== '.json') {
    io.err(`documentor: contract reads a .json data file, got ${extname(input) || 'a file with no extension'}`);
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
    const loaded = await loadContract(input);
    for (const w of loaded.warnings) io.err(`documentor: warning — ${w}`);
    ({ doc, dropped } = assembleContract({ data: loaded.data, template: loaded.template }));
  } catch (e) {
    if (e instanceof ContractError) {
      io.err(`documentor: the contract cannot be assembled — ${e.errors.length} problem(s):`);
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
  const stem = contractStem(input);

  const browser = formats.includes('pdf') ? await chromium.launch() : undefined;
  try {
    for (const format of formats) {
      const target = join(dir, `${stem}.${theme.id}.${format}`);
      const bytes =
        format === 'pdf'
          ? await renderPdf(doc, theme, {
              epochSeconds,
              onWarn: (m) => io.err(`documentor: warning — ${m}`),
              ...(browser === undefined ? {} : { browser }),
            })
          : format === 'docx'
            ? await renderDocx(doc, theme, { epochSeconds })
            : Buffer.from(renderMarkdown(doc), 'utf8');
      await writeFile(target, bytes);
      io.log(`${target}  (${bytes.length.toLocaleString('en-US')} bytes)`);
    }
  } finally {
    if (browser !== undefined) await browser.close();
  }
  return 0;
}
