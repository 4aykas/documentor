// Text widths for a chart's layout, measured in the diagram page with the
// theme's own faces (already decoded there), regular and semibold.

import type { Page } from 'playwright-core';
import type { Widths } from './draw.js';

export async function measureWidths(page: Page, strings: { regular: string[]; bold: string[] }, family: string, px: number): Promise<Widths> {
  const got = await page.evaluate(`(() => {
    const c = document.createElement('canvas').getContext('2d');
    const measure = (list, weight) => { c.font = weight + ' ' + ${JSON.stringify(`${px}px `)} + ${JSON.stringify(family)}; return list.map((s) => c.measureText(s).width); };
    return { regular: measure(${JSON.stringify(strings.regular)}, '400'), bold: measure(${JSON.stringify(strings.bold)}, '600') };
  })()`) as { regular: number[]; bold: number[] };
  const reg = new Map(strings.regular.map((s, i) => [s, got.regular[i]!]));
  const bold = new Map(strings.bold.map((s, i) => [s, got.bold[i]!]));
  // A string not measured in advance (a wrapped line) is the sum of its
  // words and spaces, which is how it was wrapped.
  const sum = (m: Map<string, number>, s: string) => m.get(s)
    ?? s.split(' ').reduce((a, word, i) => a + (m.get(word) ?? word.length * px * 0.55) + (i ? (m.get(' ') ?? reg.get(' ') ?? px * 0.28) : 0), 0);
  return (s, b = false) => sum(b ? bold : reg, s);
}
