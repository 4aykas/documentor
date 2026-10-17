// Draw the diagram gallery (test/fixtures/diagram-gallery.md) under each theme
// named, print how every diagram lands on the page, and lay each PDF out on
// one proof sheet — the loop a change to render/diagrams/ is judged in.
//
//   npm run diagrams:proof                     plain, tebin, haskoning
//   npm run diagrams:proof -- rams dreamscape  any themes
//
// Writes .input/diagrams-proof/<theme>.pdf and <theme>.proof.png.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { ingestMarkdown } from '../src/ingest/md.js';
import { drawDiagrams, kindOf } from '../src/render/diagrams/index.js';
import { renderPdf } from '../src/render/pdf.js';
import { loadTheme } from '../src/theme/resolve.js';
import { runProof } from '../src/cli/proof.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, '.input', 'diagrams-proof');
const themes = process.argv.slice(2).length ? process.argv.slice(2) : ['plain', 'tebin', 'haskoning'];
const source = await readFile(join(ROOT, 'test', 'fixtures', 'diagram-gallery.md'), 'utf8');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  for (const id of themes) {
    const theme = await loadTheme(id);
    const notes: string[] = [];
    const doc = await drawDiagrams(ingestMarkdown(source).doc, theme, browser, (m) => notes.push(m));
    console.log(`\n${id} (body ${theme.type.bodyPt}pt)`);
    console.log('  type              natural px    placed pt    labels pt');
    for (const b of doc.blocks) {
      if (b.t !== 'diagram') continue;
      const vb = /viewBox="[^ ]+ [^ ]+ ([\d.]+) ([\d.]+)"/.exec(b.svg);
      const [w, h] = vb ? [Number(vb[1]), Number(vb[2])] : [0, 0];
      const scale = w ? b.wPt / (w * 0.75) : 0;
      const pt = theme.type.bodyPt * scale;
      console.log(`  ${kindOf(b.source).padEnd(17)} ${`${Math.round(w)}×${Math.round(h)}`.padEnd(13)} ${`${Math.round(b.wPt)}×${Math.round(b.hPt)}`.padEnd(12)} ${pt.toFixed(1)}${pt < theme.type.bodyPt * 0.75 ? '  ← small' : ''}`);
    }
    for (const n of notes) console.log(`  note: ${n}`);
    const pdf = join(OUT, `${id}.pdf`);
    await writeFile(pdf, await renderPdf(doc, theme, { epochSeconds: 1_000_000_000, browser }));
    await runProof([pdf, '--cols', '4', '--width', '480'], { log: (s) => console.log(`  ${s}`), err: (s) => console.error(s) });
  }
} finally {
  await browser.close();
}
