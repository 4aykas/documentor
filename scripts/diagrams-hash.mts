// Hash every gallery diagram (test/fixtures/diagram-gallery.md) under each
// theme named: the check for a change that must not change any drawing — a
// refactor of render/diagrams/, a dependency bump that should be inert.
//
//   npm run diagrams:hash -- --out before.json            record
//   npm run diagrams:hash -- --compare before.json        exit 1 on any difference
//   npm run diagrams:hash -- --compare before.json rams   themes after the flags
//
// Default themes: plain, tebin, haskoning. Records SVG and PNG hashes, the
// placed size and the build's warnings per theme.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { ingestMarkdown } from '../src/ingest/md.js';
import { drawDiagrams } from '../src/render/diagrams/index.js';
import { loadTheme } from '../src/theme/resolve.js';

type Row = { kind: string; svg: string; png: string; wPt: number; hPt: number };
type Record_ = Record<string, { diagrams: Row[]; warnings: string[] }>;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i === -1 ? undefined : args.splice(i, 2)[1]; };
const out = flag('--out');
const compare = flag('--compare');
if (!out && !compare) {
  console.error('diagrams:hash needs --out <file.json> or --compare <file.json>');
  process.exit(2);
}
const themes = args.length ? args : ['plain', 'tebin', 'haskoning'];
const h = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const source = await readFile(join(ROOT, 'test', 'fixtures', 'diagram-gallery.md'), 'utf8');

const now: Record_ = {};
const browser = await chromium.launch();
try {
  for (const id of themes) {
    const warnings: string[] = [];
    const doc = await drawDiagrams(ingestMarkdown(source).doc, await loadTheme(id), browser, (m) => warnings.push(m));
    const diagrams = doc.blocks.flatMap((b) => b.t === 'diagram'
      ? [{ kind: b.kind, svg: h(b.svg), png: h(b.png), wPt: b.wPt, hPt: b.hPt }] : []);
    now[id] = { diagrams, warnings };
  }
} finally {
  await browser.close();
}

if (out) {
  await writeFile(out, JSON.stringify(now, null, 1) + '\n');
  console.log(`wrote ${out} (${themes.join(', ')})`);
}
if (compare) {
  const before = JSON.parse(await readFile(compare, 'utf8')) as Record_;
  const diffs: string[] = [];
  for (const id of themes) {
    const a = before[id];
    const b = now[id]!;
    if (!a) { diffs.push(`${id}: not in ${compare}`); continue; }
    const n = Math.max(a.diagrams.length, b.diagrams.length);
    for (let i = 0; i < n; i++) {
      const x = a.diagrams[i], y = b.diagrams[i];
      if (JSON.stringify(x) !== JSON.stringify(y)) {
        const what = !x || !y ? 'added or removed'
          : (['svg', 'png', 'wPt', 'hPt'] as const).filter((k) => x[k] !== y[k]).join(', ');
        diffs.push(`${id}: diagram ${i + 1} (${(y ?? x)!.kind || 'unrecorded'}) differs in ${what}`);
      }
    }
    if (JSON.stringify(a.warnings) !== JSON.stringify(b.warnings)) diffs.push(`${id}: the warnings differ`);
  }
  for (const d of diffs) console.log(d);
  console.log(diffs.length ? `${diffs.length} difference(s) from ${compare}` : `identical to ${compare}`);
  process.exit(diffs.length ? 1 : 0);
}
