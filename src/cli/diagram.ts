// `documentor diagram <file.md>` — the first diagram fence of a Markdown file
// (```mermaid, ```chart or ```axonometric) drawn on its own, as a standalone
// SVG and optionally a PNG, in a theme's colours and faces, with the same
// checks a build runs. For a figure that goes somewhere other than a
// documentor document: a post's image, a slide. It is the stable way in for
// another tool, instead of importing src/render/diagrams/ (the marketing
// repository did that and would break on any refactor).

import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { ingestMarkdown } from '../ingest/md.js';
import { drawDiagrams, isDiagramSource } from '../render/diagrams/index.js';
import { loadTheme } from '../theme/resolve.js';
import { PAGE_PT } from '../theme/types.js';
import { launchBrowser } from './preflight.js';

type Io = { log: (s: string) => void; err: (s: string) => void };

export const DIAGRAM_USAGE_LINE = '  documentor diagram <file.md> [--out <file.svg>] [--png <file.png>] [--theme plain] [--width <pt>]';

export type DiagramArgs = { input?: string; out?: string; png?: string; theme: string; width?: number };

export function parseDiagramArgs(argv: string[]): DiagramArgs {
  const o: DiagramArgs = { theme: 'plain' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--out') o.out = next();
    else if (a === '--png') o.png = next();
    else if (a === '--theme') o.theme = next();
    else if (a === '--width') {
      const v = next(), n = Number(v);
      if (!Number.isFinite(n) || n < 120 || n > 2000) throw new Error(`--width takes a column width in points from 120 to 2000, got ${JSON.stringify(v)}`);
      o.width = n;
    } else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else if (o.input === undefined) o.input = a;
    else throw new Error(`unexpected argument ${JSON.stringify(a)}`);
  }
  return o;
}

/**
 * Exit codes: 0 drawn with no finding; 1 drawn, with a D- finding (the files
 * are written, the warning says what to change); 2 a usage error or no
 * diagram fence in the file; 3 the fence could not be drawn (Mermaid's parse
 * error, or a chart or figure refused), and nothing is written.
 */
export async function runDiagram(argv: string[], io: Io): Promise<number> {
  let args: DiagramArgs;
  try {
    args = parseDiagramArgs(argv);
  } catch (e) {
    io.err(`documentor: ${(e as Error).message}\n\n${DIAGRAM_USAGE_LINE}`);
    return 2;
  }
  if (args.input === undefined || !['.md', '.markdown'].includes(extname(args.input).toLowerCase())) {
    io.err(`documentor: diagram needs a Markdown file\n\n${DIAGRAM_USAGE_LINE}`);
    return 2;
  }
  const input = resolve(args.input);
  const source = ingestMarkdown(await readFile(input, 'utf8')).doc;
  const fence = source.blocks.find(isDiagramSource);
  if (fence === undefined) {
    io.err(`documentor: ${basename(input)} has no \`\`\`mermaid, \`\`\`chart or \`\`\`axonometric fence`);
    return 2;
  }
  const theme = await loadTheme(args.theme);
  // The diagram is laid out to the column it would have in the theme's page,
  // or to --width points: narrower when the figure will be shown larger.
  const pageW = PAGE_PT[theme.page.size].w;
  const page = args.width === undefined ? theme.page : { ...theme.page, marginPt: (pageW - args.width) / 2 };
  const warnings: string[] = [];
  const browser = await launchBrowser(io);
  let drawn;
  try {
    drawn = await drawDiagrams({ ...source, blocks: [fence] }, { ...theme, page }, browser, (m) => warnings.push(m));
  } finally {
    await browser.close();
  }
  for (const w of warnings) io.err(`documentor: warning — ${w}`);
  const d = drawn.blocks[0];
  if (d === undefined || d.t !== 'diagram') return 3;
  // A file on its own needs the SVG namespace, which an inline SVG does not.
  const ns = 'http' + '://www.w3.org/2000/svg';
  const out = resolve(args.out ?? join(dirname(input), `${basename(input, extname(input))}.svg`));
  await writeFile(out, d.svg.replace(/^<svg /, `<svg xmlns="${ns}" `));
  io.log(out);
  if (args.png !== undefined) {
    const png = resolve(args.png);
    await writeFile(png, Buffer.from(d.png.slice(d.png.indexOf(',') + 1), 'base64'));
    io.log(png);
  }
  return warnings.some((w) => / D-[A-Z]+:/.test(w)) ? 1 : 0;
}
