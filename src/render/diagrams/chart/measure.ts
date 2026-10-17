// Text widths for a chart's layout, measured in the diagram page with the
// theme's own faces (already decoded there), regular and semibold. Measured
// as SVG text set exactly as the chart sets it — tabular figures included,
// which a canvas cannot do: in Inter, "1,111,111" is 40.7 px proportional
// and 63.6 px tabular, and the layout must reserve the drawn width.

import type { Page } from 'playwright-core';
import type { Widths } from './draw.js';

/** Load the regular, semibold and bold of a face, every subset `text` needs. */
export async function loadFaces(page: Page, family: string, px: number, text: string): Promise<void> {
  const first = JSON.stringify(family.split(',')[0]!.trim());
  await page.evaluate(`Promise.all(['400', '600', '700'].map((wt) => document.fonts.load(wt + ' ${px}px ' + ${first}, ${JSON.stringify(text || 'A')})))
    .then(() => document.fonts.ready)`);
}

export async function measureWidths(page: Page, strings: { regular: string[]; bold: string[] }, family: string, px: number): Promise<Widths> {
  // A face's weights load on first use, and the page has only asked for the
  // regular one; measured before its semibold is in, a label is measured in
  // a stand-in face and drawn wider (Inter, on a dark sheet, 2026-10-17).
  // A face also comes in script subsets (unicode-range), each loaded only for
  // text that needs it: loading with the chart's own text brings Cyrillic in
  // as well as Latin (the review of 2e20fc5).
  await loadFaces(page, family, px, [...strings.regular, ...strings.bold].join(' '));
  const got = await page.evaluate(`(() => {
    // The SVG namespace, a name and not an address: nothing is fetched.
    const ns = 'http' + '://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('style', 'position:absolute;left:-10000px;top:0;width:1px;height:1px;overflow:visible');
    document.body.appendChild(svg);
    const measure = (list, weight) => list.map((s) => {
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('style', 'font-family:' + ${JSON.stringify(family)} + ';font-size:' + ${JSON.stringify(`${px}px`)}
        + ';font-weight:' + weight + ';font-variant-numeric:tabular-nums;white-space:pre');
      t.textContent = s;
      svg.appendChild(t);
      const w = t.getComputedTextLength();
      t.remove();
      return w;
    });
    const out = { regular: measure(${JSON.stringify(strings.regular)}, '400'), bold: measure(${JSON.stringify(strings.bold)}, '600') };
    svg.remove();
    return out;
  })()`) as { regular: number[]; bold: number[] };
  const reg = new Map(strings.regular.map((s, i) => [s, got.regular[i]!]));
  const bold = new Map(strings.bold.map((s, i) => [s, got.bold[i]!]));
  // A string not measured in advance (a wrapped line) is the sum of its
  // words and spaces, which is how it was wrapped.
  const sum = (m: Map<string, number>, s: string) => m.get(s)
    ?? s.split(' ').reduce((a, word, i) => a + (m.get(word) ?? word.length * px * 0.55) + (i ? (m.get(' ') ?? reg.get(' ') ?? px * 0.28) : 0), 0);
  return (s, b = false) => sum(b ? bold : reg, s);
}
