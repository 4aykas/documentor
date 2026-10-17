import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { ingestMarkdown } from '../../src/ingest/md.js';
import type { Block } from '../../src/ir/types.js';
import { parseChart, parseNumber } from '../../src/render/diagrams/chart/parse.js';
import { drawDiagrams } from '../../src/render/diagrams/index.js';
import { loadTheme } from '../../src/theme/resolve.js';

// The ```chart engine (docs/adr/0008). The parser refuses what it cannot read
// exactly, and a waterfall that does not reconcile; the drawing carries every
// word of the fence, re-derives from its own data-* declarations, and no
// chart the parser accepts draws a clipped, colliding or covered label.

describe('numbers', () => {
  it('reads the conventions it promises, and keeps the text as written', () => {
    expect(parseNumber('1,704,545')).toMatchObject({ value: 1704545, text: '1,704,545', sep: ',' });
    expect(parseNumber("1'704'545.50")).toMatchObject({ value: 1704545.5, decimals: 2, sep: "'" });
    expect(parseNumber('1 704')).toMatchObject({ value: 1704, sep: ' ' });
    expect(parseNumber('−5.3')).toMatchObject({ value: -5.3, signed: true });
    expect(parseNumber('+17,329')).toMatchObject({ value: 17329, signed: true });
    expect(parseNumber('1704545')).toMatchObject({ value: 1704545, sep: '' });
  });

  it('refuses what it would have to guess', () => {
    for (const t of ['1,5', '12,34,567', '1,234\'567', '1.234,5', '5%', 'abc', '']) expect(parseNumber(t), t).toBeNull();
  });
});

describe('parseChart', () => {
  const ok = (s: string) => { const p = parseChart(s); if (!p.ok) throw new Error(p.error); return p.chart; };
  const refused = (s: string) => { const p = parseChart(s); expect(p.ok).toBe(false); return p.ok ? '' : p.error; };

  it('reads a bar chart: label is everything before the number, settings before or after the rows', () => {
    const c = ok('bar\ntitle T\nPhase 2 delivery  1,000  focus\nmark +10 Ceiling\n');
    expect(c.rows[0]).toMatchObject({ label: 'Phase 2 delivery', focus: true });
    expect(c.marks[0]!.label).toBe('Ceiling');
  });

  it('names the line it cannot read', () => {
    expect(refused('bar\nServices 1,5\n')).toMatch(/^line 2: "1,5" is not a number/);
    expect(refused('pie\nA 1\n')).toMatch(/^line 1: a chart starts with its type/);
    expect(refused('dumbbell\nA 1 2\n')).toMatch(/before <name>/);
  });

  it('reconciles a waterfall exactly, in decimals', () => {
    ok('waterfall\ntotal A 0.1\nstep B +0.2\ntotal C 0.3\n');
    expect(refused('waterfall\ntotal A 100\nstep B +10\ntotal C 111\n')).toMatch(/line 4: the total 111 does not equal the running sum 110 \(difference 1\)/);
    expect(refused('waterfall\ntotal A 100\nstep B 10\ntotal C 110\n')).toMatch(/carries its sign/);
    expect(refused('waterfall\ntotal A 100\nstep B +0\ntotal C 100\n')).toMatch(/zero step/);
    expect(refused('waterfall\nstep B +1\ntotal C 1\n')).toMatch(/opens on a total/);
    expect(refused('waterfall\naxis 105\ntotal A 100\nstep B +10\ntotal C 110\n')).toMatch(/axis 105 lies above/);
  });
});

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

type Diagram = Extract<Block, { t: 'diagram' }>;
const draw = async (fences: string[], warn: string[] = []) => {
  const md = fences.map((f) => `\`\`\`chart\n${f}\n\`\`\``).join('\n\n') + '\n';
  const doc = await drawDiagrams(ingestMarkdown(md).doc, await loadTheme('plain'), browser, (m) => warn.push(m));
  return doc.blocks.filter((b): b is Diagram => b.t === 'diagram');
};

const WATERFALL = 'waterfall\ntitle Hours\ndesc From plan to booked.\nunit h\naxis 2,000\ntotal Planned 2,700\nstep Mechanical +78\nstep Electrical +96 focus\nstep Structural -26\ntotal Booked 2,848';

describe('a drawn chart', () => {
  it('carries every word of its fence', async () => {
    const [d] = await draw([WATERFALL]);
    const page = await browser.newPage();
    try {
      await page.setContent(`<div id="host">${d!.svg}</div>`);
      const drawnText = await page.evaluate(`document.querySelector('#host svg').textContent`) as string;
      const keywords = new Set(['waterfall', 'title', 'desc', 'unit', 'axis', 'total', 'step', 'focus']);
      for (const word of WATERFALL.split(/\s+/).filter((w) => !keywords.has(w))) expect(drawnText, word).toContain(word);
      expect(d!.title).toBe('Hours');
      expect(d!.desc).toBe('From plan to booked.');
    } finally {
      await page.close();
    }
  });

  // diagram-design's verify-waterfall.py, as a test: the drawing is
  // re-derived from its own declarations and must agree with them.
  it('draws a waterfall its declarations reconcile with', async () => {
    const [d] = await draw([WATERFALL]);
    const page = await browser.newPage();
    try {
      await page.setContent(`<div id="host">${d!.svg}</div>`);
      const bars = await page.evaluate(`[...document.querySelectorAll('#host rect[data-role]')].map((r) => ({
        role: r.dataset.role, value: r.dataset.value, y: +r.getAttribute('y'), h: +r.getAttribute('height') }))`) as
        { role: string; value: string; y: number; h: number }[];
      const carries = await page.evaluate(`[...document.querySelectorAll('#host line[data-carry]')].map((l) => ({ level: +l.dataset.carry, y: +l.getAttribute('y1') }))`) as { level: number; y: number }[];
      const num = (s: string) => Number(s.replace(/[,' ]/g, '').replace('−', '-'));
      // Scale from the first total: its top is at its level, its foot at the axis.
      const base = bars[0]!.y + bars[0]!.h;
      const k = bars[0]!.h / (num(bars[0]!.value) - 2000);
      const yOf = (v: number) => base - (v - 2000) * k;
      let run = 0;
      bars.forEach((b, i) => {
        const v = num(b.value);
        if (b.role === 'delta') {
          const [lo, hi] = [Math.min(run, run + v), Math.max(run, run + v)];
          expect(b.y, `bar ${i} top`).toBeCloseTo(yOf(hi), 0);
          expect(b.y + b.h, `bar ${i} foot`).toBeCloseTo(yOf(lo), 0);
          run += v;
        } else {
          if (i > 0) expect(v, `total ${i} reconciles`).toBe(run);
          run = v;
          expect(b.y, `total ${i} top`).toBeCloseTo(yOf(v), 0);
          expect(b.y + b.h, `total ${i} stands on the axis`).toBeCloseTo(base, 0);
        }
        if (i < bars.length - 1) {
          expect(carries[i]!.level, `carry ${i}`).toBe(run);
          expect(carries[i]!.y, `carry ${i} height`).toBeCloseTo(yOf(run), 0);
        }
      });
      expect(bars.map((b) => b.role)).toEqual(['total', 'delta', 'delta', 'delta', 'total']);
    } finally {
      await page.close();
    }
  });

  it('starts a bar chart at zero, negative bars to its left', async () => {
    const [d] = await draw(['bar\nUp +4\nDown -3']);
    const page = await browser.newPage();
    try {
      await page.setContent(`<div id="host">${d!.svg}</div>`);
      const [zero, up, down] = await page.evaluate(`[
        +document.querySelector('#host line[data-zero]').getAttribute('x1'),
        ...[...document.querySelectorAll('#host rect[data-role=bar]')].map((r) => [+r.getAttribute('x'), +r.getAttribute('width')]),
      ]`) as [number, [number, number], [number, number]];
      expect(up[0]).toBeCloseTo(zero, 0);
      expect(down[0] + down[1]).toBeCloseTo(zero, 0);
      expect(up[1] / down[1]).toBeCloseTo(4 / 3, 1);
    } finally {
      await page.close();
    }
  });

  it('is refused, printed as its source with the line named, when it does not reconcile', async () => {
    const warn: string[] = [];
    const drawn = await draw(['waterfall\ntotal A 100\nstep B +10\ntotal C 111'], warn);
    expect(drawn).toEqual([]);
    expect(warn.join('\n')).toMatch(/diagram 1 \(chart\) could not be drawn and is printed as its source instead: line 4: the total 111/);
  });
});

// Generated charts across the grammar: labels long and short, values small
// and large, signs mixed. The layout must keep every label whole and apart.
describe('charts the parser accepts', () => {
  it('draw no clipped, colliding or covered label', async () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    const words = ['Design', 'Coordination', 'Mechanical services', 'Electrical', 'Fire safety and alarms', 'Civil', 'BIM', 'Structural steel works'];
    const label = () => words[Math.floor(rnd() * words.length)]!;
    const n = (lo: number, hi: number) => Math.round(lo + rnd() * (hi - lo));
    const fmt = (v: number) => v.toLocaleString('en-US');
    const fences: string[] = [];
    for (let k = 0; k < 6; k++) {
      const rows = Array.from({ length: n(2, 8) }, () => `${label()} ${(rnd() < 0.3 ? '-' : '+')}${fmt(n(1, 900))}`);
      // Units as long as real ones: a one-letter unit never reaches a tick.
      fences.push(`bar\ntitle Generated bar ${k}\nunit hours of design work\n${rows.join('\n')}`);
      const pairs = Array.from({ length: n(2, 6) }, () => `${label()} ${fmt(n(100, 5000))} ${fmt(n(100, 5000))}`);
      fences.push(`dumbbell\ntitle Generated dumbbell ${k}\nunit hours of design work\nbefore Plan\nafter Actual\n${pairs.join('\n')}`);
      let run = n(5000, 20000);
      const steps = Array.from({ length: n(1, 5) }, () => { const v = n(-900, 900) || 1; run += v; return `step ${label()} ${v > 0 ? '+' : '-'}${fmt(Math.abs(v))}`; });
      fences.push(`waterfall\ntitle Generated waterfall ${k}\ntotal Start ${fmt(run - steps.reduce((s, l) => s + Number(l.split(' ').at(-1)!.replace(/,/g, '')), 0))}\n${steps.join('\n')}\ntotal End ${fmt(run)}`);
    }
    const warn: string[] = [];
    const drawn = await draw(fences, warn);
    expect(warn.filter((w) => /could not be drawn/.test(w))).toEqual([]);
    expect(drawn).toHaveLength(fences.length);
    expect(warn.filter((w) => / D-(CLIP|COLLIDE|COVER):/.test(w))).toEqual([]);
  }, 120_000);
});
