// `documentor theme capture <url> --name <id>` — measure a web page someone
// likes (see theme/capture.ts) and write the evidence a theme is then written
// from. It renders no document and writes no theme: turning a measurement into
// a theme is a judgement, made by a person reading the capture beside its
// screenshot.

import { resolve } from 'node:path';
import { capturePage, writeCapture } from '../theme/capture.js';
import { launchBrowser } from './preflight.js';

type Io = { log: (s: string) => void; err: (s: string) => void };

export const THEME_USAGE_LINE = '  documentor theme capture <url> --name <id> [--out <dir>]';

const ID = /^[a-z0-9][a-z0-9-]*$/;

export function parseThemeArgs(argv: string[]): { sub?: string; url?: string; name?: string; out?: string } {
  const out: { sub?: string; url?: string; name?: string; out?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--name') out.name = next();
    else if (a === '--out') out.out = next();
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else if (out.sub === undefined) out.sub = a;
    else if (out.url === undefined) out.url = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  return out;
}

export async function runTheme(argv: string[], io: Io): Promise<number> {
  let args: ReturnType<typeof parseThemeArgs>;
  try {
    args = parseThemeArgs(argv);
    if (args.sub !== 'capture') throw new Error(`unknown theme command ${JSON.stringify(args.sub ?? '')}`);
    if (args.url === undefined || !/^https?:\/\//i.test(args.url)) throw new Error('capture needs an http(s) URL');
    if (args.name === undefined || !ID.test(args.name)) {
      throw new Error('capture needs --name <id>: lower-case letters, digits and hyphens, the id the theme will have');
    }
  } catch (e) {
    io.err(`documentor: ${(e as Error).message}\n\n${THEME_USAGE_LINE}`);
    return 2;
  }

  // Under .input/ by default: a capture is a record of somebody else's site,
  // screenshot included, and .input/ is the directory this repository keeps
  // out of git for exactly that kind of material.
  const dir = resolve(args.out ?? `.input/captures/${args.name}`);
  const browser = await launchBrowser(io);
  let result;
  try {
    result = await capturePage(args.url, { browser });
  } finally {
    await browser.close();
  }
  const written = await writeCapture(dir, result);
  const c = result.capture;
  io.log(`captured ${c.url}`);
  for (const f of c.fonts.slice(0, 4)) {
    const sizes = f.sizesPx.slice(0, 3).map((s) => `${s.px}px`).join(', ');
    io.log(`  font  ${f.family} — ${Math.round(f.share * 100)}% of text; ${sizes}`);
  }
  io.log(`  text  ${c.textColors.slice(0, 4).map((t) => t.hex).join(' ')}`);
  io.log(`  fills ${c.backgrounds.slice(0, 4).map((b) => b.hex).join(' ')}`);
  for (const f of written) io.log(`wrote ${f}`);
  return 0;
}
