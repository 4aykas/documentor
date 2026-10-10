// `documentor proof <file.pdf>` — every page of a PDF on one contact sheet,
// so a layout is checked by looking at one image rather than at each page in
// turn. The pages are drawn by pdfjs (already a dependency, for reading
// PDFs) inside the same Chromium that prints them, so proofing adds nothing
// to install: no native canvas, no system poppler.

import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { launchBrowser } from './preflight.js';

type Io = { log: (s: string) => void; err: (s: string) => void };

export const PROOF_USAGE_LINE = '  documentor proof <file.pdf> [--out <file.png>] [--cols 4] [--width 360]';

export function parseProofArgs(argv: string[]): { input?: string; out?: string; cols: number; width: number } {
  const o: { input?: string; out?: string; cols: number; width: number } = { cols: 4, width: 360 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    const count = (v: string, lo: number, hi: number) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${a} takes a whole number from ${lo} to ${hi}, got ${JSON.stringify(v)}`);
      return n;
    };
    if (a === '--out') o.out = next();
    else if (a === '--cols') o.cols = count(next(), 1, 12);
    else if (a === '--width') o.width = count(next(), 120, 1600);
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else if (o.input === undefined) o.input = a;
    else throw new Error(`unexpected argument ${JSON.stringify(a)}`);
  }
  return o;
}

/** Runs in the page: draws every page, lays them out, returns a PNG data URL. */
const SHEET = `async ([lib, worker, b64, cols, width]) => {
  const url = (code) => URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  const pdfjs = await import(url(lib));
  pdfjs.GlobalWorkerOptions.workerSrc = url(worker);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const tiles = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const v = page.getViewport({ scale: width / vp.width });
    const c = document.createElement('canvas');
    c.width = Math.round(v.width); c.height = Math.round(v.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
    tiles.push(c);
  }
  const gap = 12, label = 18, rows = Math.ceil(tiles.length / cols);
  const th = Math.max(...tiles.map((t) => t.height));
  const sheet = document.createElement('canvas');
  sheet.width = cols * width + (cols + 1) * gap;
  sheet.height = rows * (th + label) + (rows + 1) * gap;
  const g = sheet.getContext('2d');
  g.fillStyle = '#7A7A7A'; g.fillRect(0, 0, sheet.width, sheet.height);
  g.font = '12px sans-serif'; g.fillStyle = '#FFFFFF';
  tiles.forEach((t, i) => {
    const x = gap + (i % cols) * (width + gap), y = gap + Math.floor(i / cols) * (th + label + gap);
    g.drawImage(t, x, y);
    g.fillText(String(i + 1), x, y + t.height + 14);
  });
  return { png: sheet.toDataURL('image/png'), pages: tiles.length };
}`;

export async function runProof(argv: string[], io: Io): Promise<number> {
  let args: ReturnType<typeof parseProofArgs>;
  try {
    args = parseProofArgs(argv);
  } catch (e) {
    io.err(`documentor: ${(e as Error).message}\n\n${PROOF_USAGE_LINE}`);
    return 2;
  }
  if (args.input === undefined || extname(args.input).toLowerCase() !== '.pdf') {
    io.err(`documentor: proof needs a .pdf file\n\n${PROOF_USAGE_LINE}`);
    return 2;
  }
  const input = resolve(args.input);
  const out = resolve(args.out ?? join(dirname(input), `${basename(input, extname(input))}.proof.png`));
  const require = createRequire(import.meta.url);
  const [lib, worker, pdf] = await Promise.all([
    readFile(require.resolve('pdfjs-dist/build/pdf.min.mjs'), 'utf8'),
    readFile(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'), 'utf8'),
    readFile(input),
  ]);
  const browser = await launchBrowser(io);
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    const res = (await page.evaluate(`(${SHEET})(${JSON.stringify([lib, worker, pdf.toString('base64'), args.cols, args.width])})`)) as { png: string; pages: number };
    await writeFile(out, Buffer.from(res.png.replace(/^data:image\/png;base64,/, ''), 'base64'));
    io.log(`${out}  (${res.pages} page${res.pages === 1 ? '' : 's'})`);
    return 0;
  } finally {
    await browser.close();
  }
}
