import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { ingestMarkdown } from '../../src/ingest/md.js';
import type { Block } from '../../src/ir/types.js';
import { parseChart, parseNumber } from '../../src/render/diagrams/chart/parse.js';
import { seriesFills } from '../../src/render/diagrams/chart/draw.js';
import { diagramTokens } from '../../src/render/diagrams/index.js';
import { luminance } from '../../src/render/tint.js';
import { drawDiagrams } from '../../src/render/diagrams/index.js';
import { loadTheme, resolveTheme } from '../../src/theme/resolve.js';

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

  it('refuses what the review found it misread (2026-10-17)', () => {
    // Thousands with a plain space: a label and 500, or 12,500?
    expect(refused('bar\nPersonnel 12 500\n')).toMatch(/is "12 500" one number\?/);
    expect(refused('bar\nC 3 000\n')).toMatch(/is "3 000" one number\?/);
    ok('bar\nPersonnel 12 500\n');
    // A setting twice, or one this type does not take.
    expect(refused('bar\ntitle A\ntitle B\nX 1\n')).toMatch(/title is set twice/);
    expect(refused('bar\naxis 5\nX 1\n')).toMatch(/axis is not a bar setting/);
    // Too many digits to place exactly.
    expect(refused('bar\nX 1234567890123456\n')).toMatch(/is not a number/);
    // A waterfall below zero.
    expect(refused('waterfall\ntotal A 10\nstep B -30\ntotal C -20\n')).toMatch(/runs below zero/);
  });

  it('reads a grouped bar, one value per series, - for none', () => {
    const c = ok('grouped\nseries Diesel\nseries Urea\nMulti-level 300 40\nUrea only - 50 focus\n');
    expect(c.series).toEqual(['Diesel', 'Urea']);
    expect(c.rows.map((r) => r.values.map((v) => v.text))).toEqual([['300', '40'], ['', '50']]);
    expect(refused('grouped\nseries A\nX 1\n')).toMatch(/names two to four series first/);
    expect(refused('grouped\nseries A\nseries B\nX 1\n')).toMatch(/needs a label and 2 numbers/);
    expect(refused('grouped\nseries A\nseries B\nX - -\n')).toMatch(/at least one value/);
    // A row has exactly one value per series, so a label may end in a number.
    // ("Bay 2 300" stays refused: it could be 2,300 with a plain space.)
    expect(ok('grouped\nseries A\nseries B\n2023 5 6\nBay 2B 300 40\n').rows.map((r) => r.label)).toEqual(['2023', 'Bay 2B']);
    expect(refused('grouped\nseries A\nseries B\nseries C\nNorth 300 - -\nSouth 200 - -\n')).toMatch(/the series "B" has no value in any row/);
    expect(refused('grouped\nseries A\nseries B\nX 1 2\nseries C\n')).toMatch(/series before its rows/);
    expect(refused('bar\nX -\n')).toMatch(/is not a number/);
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
      // Drawn text only: <title>, <desc> and <style> are not on the page.
      const drawnText = await page.evaluate(`[...document.querySelectorAll('#host svg text')].map((t) => t.textContent).join(' ')`) as string;
      const keywords = new Set(['waterfall', 'title', 'desc', 'unit', 'axis', 'total', 'step', 'focus']);
      const descWords = new Set('From plan to booked.'.split(' '));
      for (const word of WATERFALL.split(/\s+/).filter((w) => !keywords.has(w) && !descWords.has(w))) expect(drawnText, word).toContain(word);
      expect(d!.svg).toContain('<desc id="chart-desc-dg0">From plan to booked.</desc>');
      expect(d!.title).toBe('Hours');
      expect(d!.desc).toBe('From plan to booked.');
    } finally {
      await page.close();
    }
  });

  // diagram-design's verify-waterfall.py, as a test: the drawing is
  // re-derived from its own declarations and must agree with them.
  it.each([
    [WATERFALL, 2000, ['total', 'delta', 'delta', 'delta', 'total']],
    // No axis, decimals at two scales, a subtotal.
    ['waterfall\ntotal Start 10.5\nstep Up +2.25\ntotal Mid 12.75\nstep Down -0.5\ntotal End 12.25', 0, ['total', 'delta', 'subtotal', 'delta', 'total']],
  ] as const)('draws a waterfall its declarations reconcile with (%#)', async (fence, floor, roles) => {
    const [d] = await draw([fence]);
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
      const k = bars[0]!.h / (num(bars[0]!.value) - floor);
      const yOf = (v: number) => base - (v - floor) * k;
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
      expect(bars.map((b) => b.role)).toEqual(roles);
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

describe('a grouped bar\'s series fills', () => {
  // A bar is a graphic a reader must see: 3:1 against the sheet, and no two
  // series alike, in every theme with a palette that could fail it.
  // A brand as pale as rams' series steps, so the 3:1 rule has work to do.
  it.each(['plain', 'tebin', 'marine', 'rams', 'blueprint', 'schweiz', 'dark-sheet', 'pale brand'])('stand 3:1 and apart under %s', async (themeId) => {
    const t = diagramTokens(themeId === 'pale brand' ? resolveTheme({ id: 'pale', colors: { brandOnLight: '#F3E2BA' } }) : await loadTheme(themeId));
    const fills = seriesFills(t, 4);
    const ratio = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]; return (hi + 0.05) / (lo + 0.05); };
    for (const f of fills) expect(ratio(f, t.paper), f).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(Math.abs(luminance(fills[i]!) - luminance(fills[j]!)), `${i}/${j}`).toBeGreaterThanOrEqual(0.05);
  });
});

describe('text in another script', () => {
  // Cyrillic is its own subset of a face, loaded on first use: measured
  // before it arrives, the first of two identical charts drew differently.
  it('draws two identical fences identically under dark-sheet', async () => {
    const fence = '```chart\nbar\nМеханіка трубопроводів шахти 1,200\nЕлектрика 800\n```';
    const doc = await drawDiagrams(ingestMarkdown(`${fence}\n\n${fence}\n`).doc, await loadTheme('dark-sheet'), browser, () => {});
    const [a, b] = doc.blocks.flatMap((x) => (x.t === 'diagram' ? [x.svg.replace(/dg\d+/g, 'dg')] : []));
    expect(a).toBe(b);
  });
});

describe('layout the review found wrong (2026-10-17)', () => {
  it('labels a tick of 2.5 as 2.5, with one number of decimals along the axis', async () => {
    const [d] = await draw(['bar\nA 11\nB 3']);
    const ticks = [...d!.svg.matchAll(/class="tick">([^<]*)</g)].map((m) => m[1]);
    expect(ticks).toEqual(['0.0', '2.5', '5.0', '7.5', '10.0', '12.5']);
  });

  it('keeps a negative dumbbell value inside the drawing, on a scale through zero', async () => {
    const warn: string[] = [];
    const [d] = await draw(['dumbbell\nbefore Plan\nafter Actual\nMargin -5 3\nCost 4 -2'], warn);
    const xs = [...d!.svg.matchAll(/<circle cx="([-\d.]+)"/g)].map((m) => Number(m[1]));
    const w = Number(/width="(\d+)"/.exec(d!.svg)![1]);
    for (const x of xs) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(w); }
    expect(warn.filter((m) => / D-/.test(m))).toEqual([]);
  });

  it('draws a grouped bar: a bar per present value, from zero, one focus mark per row', async () => {
    const warn: string[] = [];
    const [d] = await draw(['grouped\nseries Diesel\nseries Urea\nMulti-level 300 40\nExpansion 500 -30 focus\nUrea only - 50'], warn);
    const bars = [...d!.svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"[^>]*data-role="bar" data-value="([^"]*)" data-name="([^"]*)" data-series="([^"]*)"/g)]
      .map((m) => ({ x: +m[1]!, w: +m[2]!, value: m[3], name: m[4], series: m[5] }));
    expect(bars.map((b) => `${b.name}/${b.series}=${b.value}`)).toEqual(['Multi-level/Diesel=300', 'Multi-level/Urea=40', 'Expansion/Diesel=500', 'Expansion/Urea=-30', 'Urea only/Urea=50']);
    // A row's values sit at least a text line apart (1.2 × body size), so two
    // neighbours never touch, however close their numbers.
    const valueYs = [...d!.svg.matchAll(/<text x="[\d.]+" y="([\d.]+)"[^>]*class="value">/g)].map((m) => +m[1]!);
    const body = (await loadTheme('plain')).type.bodyPt * 4 / 3;
    expect(valueYs[1]! - valueYs[0]!).toBeGreaterThanOrEqual(body * 1.2 - 0.1);
    // Every bar the SVG holds, whatever its coordinates: a "-" draws none.
    expect((d!.svg.match(/data-role="bar"/g) ?? []).length).toBe(5);
    expect(d!.svg).not.toContain('NaN');
    const zero = Number(/<line x1="([\d.]+)"[^>]*data-zero/.exec(d!.svg)![1]);
    for (const b of bars) expect(Math.min(Math.abs(b.x - zero), Math.abs(b.x + b.w - zero)), b.name).toBeLessThan(0.6);
    expect([...d!.svg.matchAll(/data-legend="([^"]*)"/g)].map((m) => m[1])).toEqual(['Diesel', 'Urea']);
    expect((d!.svg.match(/class="[^"]*\bfocus\b/g) ?? []).length).toBe(1);
    expect(warn.filter((m) => / D-/.test(m))).toEqual([]);
  });

  it('prints a decrease that ends near the axis above its bar, not on it', async () => {
    const warn: string[] = [];
    await draw(['waterfall\ntotal Budget 1,000\nstep Cut -980\ntotal Left 20'], warn);
    expect(warn.filter((m) => / D-/.test(m))).toEqual([]);
  });
});

// Generated charts across the grammar — labels long and short, signs mixed,
// marks, axes, focus rows, negative dumbbells, decreases that reach the axis
// — in a light theme and a dark one with another face. The layout must keep
// every label whole, apart, and off the bars.
describe.each(['plain', 'dark-sheet'])('charts the parser accepts, under %s', (themeId) => {
  it('draw no clipped, colliding or covered label', async () => {
    let seed = themeId.length * 7919;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    const words = ['Design', 'Coordination', 'Mechanical services', 'Electrical', 'Fire safety and alarms', 'Civil', 'BIM',
      'Structural steel works', 'Interdisciplinary', 'Commissioning support'];
    const label = () => words[Math.floor(rnd() * words.length)]!;
    const n = (lo: number, hi: number) => Math.round(lo + rnd() * (hi - lo));
    const fmt = (v: number) => (v < 0 ? '-' : '') + Math.abs(v).toLocaleString('en-US');
    const focus = () => (rnd() < 0.2 ? '  focus' : '');
    const fences: string[] = [];
    for (let k = 0; k < 8; k++) {
      const rows = Array.from({ length: n(2, 8) }, () => `${label()} ${(rnd() < 0.35 ? '-' : '+')}${fmt(n(1, 90_000))}`);
      const mark = rnd() < 0.5 ? `mark +${fmt(n(1, 60_000))} Limit\n` : '';
      // Units as long as real ones: a one-letter unit never reaches a tick.
      fences.push(`bar\ntitle Generated bar ${k}\nunit hours of design work\n${mark}${rows.join('\n')}`);
      const series = ['Design', 'Build', 'Operate', 'Retrofit'].slice(0, n(2, 4));
      const groupRows = Array.from({ length: n(2, 6) }, () => `${label()} ${series.map(() => (rnd() < 0.15 ? '-' : fmt(n(-2000, 9000)))).join(' ')}`)
        .map((r) => (r.split(' ').slice(-series.length).every((v) => v === '-') ? r.replace(/-$/, '1') : r));
      fences.push(`grouped\ntitle Generated grouped ${k}\nunit hours of design work\n${series.map((s) => `series ${s}`).join('\n')}\n${groupRows.join('\n')}`);
      const pairs = Array.from({ length: n(2, 6) }, () => `${label()} ${fmt(n(-3000, 5000))} ${fmt(n(-3000, 5000))}`);
      fences.push(`dumbbell\ntitle Generated dumbbell ${k}\nunit hours of design work\nbefore Plan\nafter Actual\n${pairs.join('\n')}`);
      const start = n(5_000, 200_000);
      let run = start;
      const steps = Array.from({ length: n(1, 5) }, () => {
        // Sometimes a decrease that takes the level close to zero.
        const v = rnd() < 0.2 ? -Math.max(1, run - n(0, 50)) : (n(-9_000, 9_000) || 1);
        if (run + v < 0) return null;
        run += v;
        return `step ${label()} ${v > 0 ? '+' : '-'}${fmt(Math.abs(v))}${focus()}`;
      }).filter((s): s is string => s !== null);
      if (steps.length === 0) continue;
      const lowest = Math.min(start, ...steps.reduce<number[]>((acc, s) => [...acc, (acc.at(-1) ?? start) + Number(s.split(' ').find((t) => /^[+-]\d/.test(t))!.replace(/,/g, ''))], []));
      const axis = rnd() < 0.4 && lowest > 1000 ? `axis ${fmt(Math.floor(lowest / 2))}\n` : '';
      fences.push(`waterfall\ntitle Generated waterfall ${k}\nunit hours\n${axis}total Start ${fmt(start)}\n${steps.join('\n')}\ntotal End ${fmt(run)}`);
    }
    const warn: string[] = [];
    const md = fences.map((f) => `\`\`\`chart\n${f}\n\`\`\``).join('\n\n') + '\n';
    if (process.env['DUMP_CHARTS']) (await import('node:fs')).writeFileSync(`${process.env['DUMP_CHARTS']}-${themeId}.md`, md);
    const doc = await drawDiagrams(ingestMarkdown(md).doc, await loadTheme(themeId), browser, (m) => warn.push(m));
    expect(warn.filter((w) => /could not be drawn/.test(w))).toEqual([]);
    expect(doc.blocks.filter((b) => b.t === 'diagram')).toHaveLength(fences.length);
    expect(warn.filter((w) => / D-(CLIP|COLLIDE|COVER):/.test(w))).toEqual([]);
  }, 180_000);
});
