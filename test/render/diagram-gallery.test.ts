import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import type { Block, Doc } from '../../src/ir/types.js';
import { drawDiagrams, kindOf } from '../../src/render/diagrams.js';
import { buildHtml } from '../../src/render/html.js';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { loadTheme } from '../../src/theme/resolve.js';

// Guardrail for a defect class that was only ever caught by eye: a Mermaid
// type falling back to Mermaid's own colours — Tableau in a sankey, pale
// yellow bars, green and cyan journey actors, a quadrant point printed as
// hsl(0, 0%, NaN%), a timeline axis in black. Each was fixed by a theme
// variable, a stylesheet rule or a repaint after drawing, and a new Mermaid
// release can undo any of them silently. The gallery holds one diagram of
// every type documentor draws; this checks what each finally paints, as the
// browser computes it, not what the SVG's attributes say.

const GALLERY = readFileSync(fileURLToPath(new URL('../fixtures/diagram-gallery.md', import.meta.url)), 'utf8');
const FENCES = [...GALLERY.matchAll(/^```mermaid$/gm)].length;

/** Mermaid's own colours, as rgb() the browser reports. */
const DEFAULTS: Record<string, string> = {
  'rgb(78, 121, 167)': 'Tableau blue (sankey)', 'rgb(242, 142, 44)': 'Tableau orange (sankey)',
  'rgb(225, 87, 89)': 'Tableau red (sankey)', 'rgb(118, 183, 178)': 'Tableau teal (sankey)',
  'rgb(89, 161, 79)': 'Tableau green (sankey)', 'rgb(237, 201, 73)': 'Tableau yellow (sankey)',
  'rgb(255, 244, 221)': 'pale yellow (xychart bars)', 'rgb(255, 216, 177)': 'peach (xychart line)',
  'rgb(143, 188, 143)': 'dark sea green (journey actor)', 'rgb(124, 252, 0)': 'lawn green (journey actor)',
  'rgb(0, 255, 255)': 'cyan (journey actor)', 'rgb(25, 25, 112)': 'navy (journey section)',
  'rgb(139, 0, 139)': 'purple (journey section)', 'rgb(236, 236, 255)': 'lavender (Mermaid default node)',
  'rgb(147, 112, 219)': 'purple (Mermaid default border)', 'rgb(0, 0, 0)': 'pure black',
};

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

const diagrams = (doc: Doc) => doc.blocks.filter((b): b is Extract<Block, { t: 'diagram' }> => b.t === 'diagram');

describe.each(['plain', 'tebin', 'haskoning'])('the diagram gallery under %s', (themeId) => {
  it('draws every type, and paints none of them in Mermaid\'s own colours', async () => {
    const theme = await loadTheme(themeId);
    const warn: string[] = [];
    const doc = await drawDiagrams(ingestMarkdown(GALLERY).doc, theme, browser, (m) => warn.push(m));
    const drawn = diagrams(doc);
    expect(warn.filter((w) => /could not be drawn/.test(w))).toEqual([]);
    expect(drawn).toHaveLength(FENCES);
    const offenders = drawn.filter((d) => /NaN/.test(d.svg)).map((d) => `${kindOf(d.source)}: a colour Mermaid computed as NaN`);

    const page = await browser.newPage();
    try {
      await page.setContent(await buildHtml(doc, theme));
      const painted = await page.evaluate(`[...document.querySelectorAll('figure.diagram')].map((f, i) => {
        const seen = new Set();
        for (const el of f.querySelectorAll('svg *')) {
          const s = getComputedStyle(el);
          if (s.display === 'none' || s.visibility === 'hidden') continue;
          for (const v of [s.fill, s.stroke, el.getAttribute('stop-color') && s.stopColor]) if (v && v.startsWith('rgb')) seen.add(v.replace(/rgba\\((\\d+), (\\d+), (\\d+), 1\\)/, 'rgb($1, $2, $3)'));
        }
        return [...seen];
      })`) as string[][];
      // A theme whose own ink is pure black paints text in it rightly.
      const n = parseInt(theme.colors.ink.slice(1), 16);
      const ink = `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
      offenders.push(...painted.flatMap((colours, i) =>
        colours.filter((c) => c in DEFAULTS && c !== ink).map((c) => `${kindOf(drawn[i]!.source)}: ${DEFAULTS[c]} ${c}`)));
      expect(offenders).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
