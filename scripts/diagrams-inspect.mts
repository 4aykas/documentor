// Draw the diagrams of one Markdown file and print what each drawing holds:
// the probe for writing a check, a selector or a layout rule.
//
//   npm run diagrams:inspect -- <file.md> [--theme <id>] [--query "<css>"]
//
// Per diagram: its type, size, the build's warnings for it, the budget
// counts, the node and cluster groups (id, class, text), the accessible
// title and description, and, with --query, every element matching the
// selector with its computed fill and stroke.

import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { ingestMarkdown } from '../src/ingest/md.js';
import { measureScript, type Measured } from '../src/render/diagrams/checks.js';
import { REGISTRY, drawDiagrams } from '../src/render/diagrams/index.js';
import { loadTheme } from '../src/theme/resolve.js';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i === -1 ? undefined : args.splice(i, 2)[1]; };
const themeId = flag('--theme') ?? 'plain';
const query = flag('--query');
const file = args[0];
if (!file) { console.error('diagrams:inspect needs a Markdown file'); process.exit(2); }

const browser = await chromium.launch();
try {
  const warnings: string[] = [];
  const doc = await drawDiagrams(ingestMarkdown(await readFile(file, 'utf8')).doc, await loadTheme(themeId), browser, (m) => warnings.push(m));
  const page = await browser.newPage();
  await page.setContent('<div id="host"></div>');
  let n = 0;
  for (const b of doc.blocks) {
    if (b.t === 'code' && (b.lang === 'mermaid' || b.lang === 'chart')) {
      n++;
      console.log(`\n#${n} not drawn`);
      for (const w of warnings.filter((x) => x.startsWith(`diagram ${n} `))) console.log(`  ${w}`);
      continue;
    }
    if (b.t !== 'diagram') continue;
    n++;
    const t = REGISTRY.find((d) => d.id === b.kind);
    const sel = Object.fromEntries(Object.entries(t?.budget ?? {}).map(([k, v]) => [k, v.count]));
    await page.evaluate(`document.getElementById('host').innerHTML = ${JSON.stringify(b.svg)}`);
    const m = await page.evaluate(measureScript(sel)) as Measured;
    console.log(`\n#${n} ${b.lang}/${b.kind || 'unrecorded'}  ${Math.round(m.w)}×${Math.round(m.h)} px, placed ${b.wPt}×${b.hPt} pt`);
    if (b.title || b.desc) console.log(`  title: ${b.title ?? '-'}  desc: ${b.desc ?? '-'}`);
    for (const w of warnings.filter((x) => x.startsWith(`diagram ${n} `))) console.log(`  ${w}`);
    if (Object.keys(m.counts).length) console.log(`  counts: ${JSON.stringify(m.counts)}  focus: ${m.focus}`);
    const groups = await page.evaluate(`[...document.querySelectorAll('#host g.node, #host g.cluster')].map((g) =>
      (g.id || '-') + ' [' + g.getAttribute('class') + '] ' + JSON.stringify(g.textContent.trim().slice(0, 24)))`) as string[];
    for (const g of groups) console.log(`  ${g}`);
    if (query) {
      const hits = await page.evaluate(`[...document.querySelectorAll('#host svg').length ? document.querySelectorAll(${JSON.stringify(`#host ${query}`)}) : []].map((el) => {
        const s = getComputedStyle(el);
        return el.tagName + ' fill=' + s.fill + ' stroke=' + s.stroke + ' ' + el.outerHTML.slice(0, 90);
      })`) as string[];
      console.log(`  ${query}: ${hits.length}`);
      for (const h of hits) console.log(`    ${h}`);
    }
  }
} finally {
  await browser.close();
}
