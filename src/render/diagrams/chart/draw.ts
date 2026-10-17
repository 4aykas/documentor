// A parsed chart laid out and drawn as SVG (docs/adr/0008). Pure: text
// widths come in already measured (measure.ts, in the page with the theme's
// faces), so every coordinate here is testable without a browser. The chart
// is laid out at the column's width and the body size, so it never scales.
//
// Shared rules: colours from the grey system with one accent; sign by fill
// weight (increase filled with a faint brand tint, decrease hollow, both
// outlined) plus geometry and the printed sign, never red against green; a
// row marked focus takes the brand. Values print exactly as written; axis
// ticks are computed chrome, in the convention of the chart's own numbers.

import { mix, type DiagramTokens } from '../tokens.js';
import { isMissing, runningLevels, type Chart, type Num } from './parse.js';

export type Widths = (s: string, bold?: boolean) => number;
export type DrawOptions = { widthPx: number; bodyPx: number; family: string; tokens: DiagramTokens; id: string };

/** The strings a chart may draw, for the page to measure in one pass. */
export function stringsOf(c: Chart): { regular: string[]; bold: string[] } {
  const words = (s: string) => s.split(' ');
  const regular = new Set<string>([' ']);
  const bold = new Set<string>();
  for (const r of c.rows) {
    regular.add(r.label);
    words(r.label).forEach((w) => regular.add(w));
    r.values.forEach((v) => { if (!isMissing(v)) bold.add(v.text); });
  }
  for (const m of c.marks) { regular.add(m.label); bold.add(m.value.text); }
  for (const s of [c.unit, c.before, c.after, ...c.series]) if (s) { regular.add(s); s.split(' ').forEach((w) => regular.add(w)); }
  if (c.title) { bold.add(c.title); words(c.title).forEach((w) => bold.add(w)); }
  if (c.axis) regular.add(c.axis.text);
  for (const t of ticksOf(c).labels) regular.add(t);
  return { regular: [...regular], bold: [...bold] };
}

// ------------------------------------------------------------------ scale

/** A step of 1, 2, 2.5 or 5 × 10^k giving about `n` intervals. */
function niceStep(range: number, n: number): number {
  const raw = range / n || 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= raw) ?? 10) * p;
}

/** The value domain and its tick values and labels. */
export function ticksOf(c: Chart): { lo: number; hi: number; values: number[]; labels: string[] } {
  const vals = c.kind === 'waterfall' ? runningLevels(c) : c.rows.flatMap((r) => r.values.filter((v) => !isMissing(v)).map((v) => v.value));
  const all = [...vals, ...c.marks.map((m) => m.value.value)];
  const floor = c.axis ? c.axis.value : 0;
  let lo = c.axis ? floor : Math.min(0, ...all);
  let hi = Math.max(c.kind === 'bar' ? 0 : floor, ...all);
  if (hi === lo) hi = lo + 1;
  const step = niceStep(hi - lo, 5);
  if (!c.axis) lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step - 1e-9) * step;
  const values: number[] = [];
  for (let v = c.axis ? Math.ceil(lo / step - 1e-9) * step : lo; v <= hi + step * 1e-9; v += step) values.push(Math.round(v / step) * step);
  // An axis start off the step gets its own label; a tick too close above it
  // would print on top of it, so that tick goes.
  if (c.axis && values[0] !== lo) values.splice(0, values[0]! - lo < step * 0.6 ? 1 : 0, lo);
  const first = c.rows.flatMap((r) => r.values).find((v) => !isMissing(v))!;
  const decimals = (String(+step.toPrecision(12)).split('.')[1] ?? '').length;
  return { lo, hi, values, labels: values.map((v) => (c.axis && v === lo ? c.axis.text : formatLike(v, decimals, first))) };
}

/** A tick value in the convention of the chart's own first number. */
function formatLike(v: number, decimals: number, like: Num): string {
  const neg = v < 0;
  const [int, frac] = Math.abs(v).toFixed(decimals).split('.');
  const grouped = like.sep ? int!.replace(/\B(?=(\d{3})+(?!\d))/g, like.sep) : int!;
  const minus = like.text.startsWith('−') ? '−' : '-';
  return `${neg ? minus : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

// ------------------------------------------------------------------ svg

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 10) / 10;

/** The widest single word of any row label: a label column narrower would push it onto the plot. */
function widestWord(c: Chart, w: Widths): number {
  return Math.max(0, ...c.rows.flatMap((r) => r.label.split(' ').map((word) => w(word))));
}

/** Greedy word wrap to `max` px; a single word wider than `max` keeps its own line. */
export function wrap(s: string, max: number, w: Widths, bold = false): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of s.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && w(line, bold) + w(' ', bold) + w(word, bold) > max) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  return out;
}

type Ctx = { o: DrawOptions; w: Widths; F: number; lineH: number; parts: string[] };

function text(x: number, y: number, s: string, o: { anchor?: 'start' | 'middle' | 'end'; bold?: boolean; fill: string; cls?: string }): string {
  return `<text x="${r1(x)}" y="${r1(y)}"${o.anchor && o.anchor !== 'start' ? ` text-anchor="${o.anchor}"` : ''}${o.bold ? ' font-weight="600"' : ''}`
    + ` fill="${o.fill}"${o.cls ? ` class="${o.cls}"` : ''}>${esc(s)}</text>`;
}

/** Title lines at the top; returns the y below them. */
function titleBlock(c: Chart, x: Ctx): number {
  if (!c.title) return 0;
  const lines = wrap(c.title, x.o.widthPx, x.w, true);
  lines.forEach((l, i) => x.parts.push(text(0, x.F * 1.05 + i * x.lineH, l, { bold: true, fill: x.o.tokens.ink, cls: 'chart-title' })));
  return lines.length * x.lineH + x.F * 0.7;
}

function wrapSvg(c: Chart, x: Ctx, h: number): string {
  const { id, family, bodyPx } = x.o;
  const t = x.o.tokens;
  const acc = [
    c.title ? `<title id="chart-title-${id}">${esc(c.title)}</title>` : '',
    c.desc ? `<desc id="chart-desc-${id}">${esc(c.desc)}</desc>` : '',
  ].join('');
  const aria = `${c.title ? ` aria-labelledby="chart-title-${id}"` : ''}${c.desc ? ` aria-describedby="chart-desc-${id}"` : ''}`;
  const W = Math.ceil(x.o.widthPx), H = Math.ceil(h);
  return `<svg id="${id}" class="chart chart-${c.kind}" role="img"${aria} width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `${acc}<style>#${id} text { font-family: ${family.replace(/"/g, "'")}; font-size: ${r1(bodyPx)}px; font-variant-numeric: tabular-nums; } `
    // A line has no fill, and the accessible title and desc are never drawn;
    // left to the browser, both compute to black.
    // No background of its own: like a Mermaid drawing, it sits on whatever
    // the layout puts behind it (a card, a panel, the sheet).
    + `#${id} { fill: ${t.ink}; } #${id} line { fill: none; } #${id} title, #${id} desc { display: none; }</style>${x.parts.join('')}</svg>`;
}

/** Fill and stroke of a bar by sign and focus. */
function barPaint(t: DiagramTokens, positive: boolean, focus: boolean, total = false): string {
  if (total) return focus ? `fill="${t.tint(0.18)}" stroke="${t.brand}" stroke-width="1.5"` : `fill="${t.faint}" stroke="${t.ink}" stroke-width="1"`;
  const fill = positive ? t.tint(focus ? 0.45 : 0.22) : t.paper;
  return `fill="${fill}" stroke="${focus ? t.brand : t.textSec}" stroke-width="${focus ? 1.5 : 1}"`;
}

// ------------------------------------------------------------------ bar

/** A grouped bar's series fill, in column order: dark grey, then the brand,
 *  then the categorical steps; identity by colour, named in the legend. */
function seriesFill(t: DiagramTokens, i: number): string {
  return i === 0 ? mix(t.ink, t.paper, 0.72) : i === 1 ? t.brand : t.series[i] ?? t.series.at(-1)!;
}

function drawBar(c: Chart, x: Ctx): string {
  const { o, w, F, lineH } = x;
  const t = o.tokens;
  let top = titleBlock(c, x);
  const grouped = c.kind === 'grouped';
  const S = grouped ? c.series.length : 1;
  if (grouped) {
    // Legend: a swatch and the series name, on one line while they fit.
    const sw = F * 0.75, gapW = F * 1.1;
    let lx = 0, ly = top + F * 0.75;
    c.series.forEach((name, i) => {
      const need = sw + F * 0.35 + w(name);
      if (lx > 0 && lx + need > o.widthPx) { lx = 0; ly += lineH; }
      x.parts.push(`<rect x="${r1(lx)}" y="${r1(ly - sw / 2)}" width="${r1(sw)}" height="${r1(sw)}" rx="1.5" fill="${seriesFill(t, i)}" data-legend="${esc(name)}"/>`);
      x.parts.push(text(lx + sw + F * 0.35, ly + F * 0.35, name, { fill: t.textSec, cls: 'legend' }));
      lx += need + gapW;
    });
    top = ly + lineH * 0.9;
  }
  const ticks = ticksOf(c);
  const present = c.rows.flatMap((r) => r.values.filter((v) => !isMissing(v)));
  const labelCol = Math.max(Math.min(Math.max(...c.rows.map((r) => w(r.label))), o.widthPx * 0.4), widestWord(c, w));
  const gap = F * 0.8;
  const valueW = Math.max(...present.map((v) => w(v.text, true))) + F * 0.45;
  const hasNeg = present.some((v) => v.value < 0), hasPos = present.some((v) => v.value > 0);
  const half = Math.max(...ticks.labels.map((l) => w(l))) / 2;
  const x0 = labelCol + gap + Math.max(hasNeg ? valueW : 0, half);
  const x1 = o.widthPx - Math.max(hasPos ? valueW : 0, half);
  const sx = (v: number) => x0 + ((v - ticks.lo) / (ticks.hi - ticks.lo)) * (x1 - x0);
  const markBand = c.marks.length ? lineH * 1.1 : 0;
  // A grouped row's bars sit a text line apart, so their values never touch.
  const barH = grouped ? F * 0.95 : F * 1.15, inner = grouped ? F * 0.35 : 0, rowGap = F * (grouped ? 0.8 : 0.55);
  const stackH = S * barH + (S - 1) * inner;
  let y = top + markBand;
  const rows = c.rows.map((r) => {
    const lines = wrap(r.label, labelCol, w);
    const h = Math.max(lines.length * lineH, stackH) + rowGap;
    const row = { r, lines, y, h };
    y += h;
    return row;
  });
  const plotTop = top + markBand, plotBottom = y;
  // grid, then marks, then bars and labels, then the zero line on top
  ticks.values.forEach((v) => x.parts.push(`<line x1="${r1(sx(v))}" y1="${r1(plotTop)}" x2="${r1(sx(v))}" y2="${r1(plotBottom)}" stroke="${t.faint}" stroke-width="1"/>`));
  ticks.values.forEach((v, i) => x.parts.push(text(sx(v), plotBottom + F * 1.15, ticks.labels[i]!, { anchor: 'middle', fill: t.textSec, cls: 'tick' })));
  for (const m of c.marks) {
    const mx = sx(m.value.value);
    x.parts.push(`<line x1="${r1(mx)}" y1="${r1(plotTop - F * 0.2)}" x2="${r1(mx)}" y2="${r1(plotBottom)}" stroke="${t.line}" stroke-width="1" stroke-dasharray="4 3" data-mark="${esc(m.value.text)}"/>`);
    const anchor = mx > (x0 + x1) / 2 ? 'end' : 'start';
    x.parts.push(text(mx + (anchor === 'end' ? -4 : 4), plotTop - F * 0.35, `${m.label} ${m.value.text}`, { anchor, fill: t.textSec, cls: 'mark' }));
  }
  for (const { r, lines, y: ry, h } of rows) {
    const cy = ry + (h - rowGap) / 2;
    // A grouped row's focus is its label: one mark per row, however many bars.
    lines.forEach((l, i) => x.parts.push(text(0, cy - ((lines.length - 1) * lineH) / 2 + i * lineH + F * 0.35, l, { fill: r.focus && grouped ? t.brand : t.ink, bold: r.focus && grouped, cls: r.focus && grouped && i === 0 ? 'label focus' : 'label' })));
    r.values.forEach((v, si) => {
      if (isMissing(v)) return;
      const by = cy - stackH / 2 + si * (barH + inner);
      const a = sx(Math.min(0, v.value)), b = sx(Math.max(0, v.value));
      const paint = grouped
        // A series is told by its colour; a negative value is that colour hollow.
        ? (v.value >= 0 ? `fill="${seriesFill(t, si)}" stroke="${seriesFill(t, si)}" stroke-width="1"` : `fill="${t.paper}" stroke="${seriesFill(t, si)}" stroke-width="1.25"`)
        : barPaint(t, v.value >= 0, r.focus);
      x.parts.push(`<rect x="${r1(a)}" y="${r1(by)}" width="${r1(Math.max(b - a, 0.5))}" height="${r1(barH)}" rx="1.5" ${paint}`
        + `${r.focus && !grouped ? ' class="focus"' : ''} data-role="bar" data-value="${esc(v.text)}" data-name="${esc(r.label)}"${grouped ? ` data-series="${esc(c.series[si]!)}"` : ''}/>`);
      const neg = v.value < 0;
      x.parts.push(text(neg ? a - F * 0.35 : b + F * 0.35, by + barH / 2 + F * 0.35, v.text, { anchor: neg ? 'end' : 'start', bold: true, fill: r.focus ? t.brand : t.ink, cls: 'value' }));
    });
  }
  x.parts.push(`<line x1="${r1(sx(0))}" y1="${r1(plotTop)}" x2="${r1(sx(0))}" y2="${r1(plotBottom)}" stroke="${t.ink}" stroke-width="1" data-zero=""/>`);
  // The unit has its own line under the tick labels, at the right edge.
  const tickBase = plotBottom + F * 1.15;
  let bottom = tickBase + F * 0.4;
  if (c.unit) { x.parts.push(text(o.widthPx, tickBase + lineH, c.unit, { anchor: 'end', fill: t.textSec, cls: 'unit' })); bottom += lineH; }
  return wrapSvg(c, x, bottom + F * 0.3);
}

// ------------------------------------------------------------------ dumbbell

function breakMark(xp: number, y: number, t: DiagramTokens, F: number): string {
  const d = F * 0.3;
  return `<path d="M${r1(xp - d)} ${r1(y + d)} L${r1(xp)} ${r1(y - d)} M${r1(xp + d * 0.3)} ${r1(y + d)} L${r1(xp + d * 1.3)} ${r1(y - d)}" stroke="${t.ink}" stroke-width="1" fill="none" data-break=""/>`;
}

function drawDumbbell(c: Chart, x: Ctx): string {
  const { o, w, F, lineH } = x;
  const t = o.tokens;
  let top = titleBlock(c, x);
  // legend: hollow before, filled after, in the author's names
  // Both entries on one line when they fit; otherwise each on its own, its
  // name wrapped to the column.
  const rDot = F * 0.36;
  const key = rDot * 2 + F * 0.35;
  const oneLine = key * 2 + w(c.before!) + w(c.after!) + F * 1.2 <= o.widthPx;
  let lx = 0, ly = top + F * 0.5;
  for (const [name, filled] of [[c.before!, false], [c.after!, true]] as const) {
    const lines = wrap(name, o.widthPx - key, w);
    x.parts.push(`<circle cx="${r1(lx + rDot)}" cy="${r1(ly)}" r="${r1(rDot)}" fill="${filled ? t.ink : t.paper}" stroke="${t.ink}" stroke-width="1.25"/>`);
    lines.forEach((l, i) => x.parts.push(text(lx + key, ly + F * 0.35 + i * lineH, l, { fill: t.textSec, cls: 'legend' })));
    if (oneLine) lx += key + w(name) + F * 1.2;
    else ly += lines.length * lineH;
  }
  top = (oneLine ? ly : ly - lineH) + lineH * 0.9;
  const ticks = ticksOf(c);
  const labelCol = Math.max(Math.min(Math.max(...c.rows.map((r) => w(r.label))), o.widthPx * 0.36), widestWord(c, w));
  const valueW = Math.max(...c.rows.flatMap((r) => r.values.map((v) => w(v.text, true)))) + rDot + F * 0.45;
  const half = Math.max(...ticks.labels.map((l) => w(l))) / 2;
  const x0 = labelCol + F * 0.8 + Math.max(valueW, half), x1 = o.widthPx - Math.max(valueW, half);
  const sx = (v: number) => x0 + ((v - ticks.lo) / (ticks.hi - ticks.lo)) * (x1 - x0);
  const rowGap = F * 0.55;
  let y = top;
  const rows = c.rows.map((r) => {
    const lines = wrap(r.label, labelCol, w);
    const h = Math.max(lines.length * lineH, rDot * 2.4) + rowGap;
    const row = { r, lines, y, h };
    y += h;
    return row;
  });
  const plotBottom = y;
  ticks.values.forEach((v, i) => {
    x.parts.push(`<line x1="${r1(sx(v))}" y1="${r1(top)}" x2="${r1(sx(v))}" y2="${r1(plotBottom)}" stroke="${t.faint}" stroke-width="1"/>`);
    x.parts.push(text(sx(v), plotBottom + F * 1.15, ticks.labels[i]!, { anchor: 'middle', fill: t.textSec, cls: 'tick' }));
  });
  x.parts.push(`<line x1="${r1(x0)}" y1="${r1(plotBottom)}" x2="${r1(x1)}" y2="${r1(plotBottom)}" stroke="${t.stroke}" stroke-width="1"/>`);
  if (c.axis) x.parts.push(breakMark(x0 + F * 0.6, plotBottom, t, F));
  for (const { r, lines, y: ry, h } of rows) {
    const [a, b] = r.values as [Num, Num];
    const cy = ry + (h - rowGap) / 2;
    lines.forEach((l, i) => x.parts.push(text(0, cy - ((lines.length - 1) * lineH) / 2 + i * lineH + F * 0.35, l, { fill: t.ink, cls: 'label' })));
    const xa = sx(a.value), xb = sx(b.value);
    const accent = r.focus ? t.brand : t.ink;
    x.parts.push(`<line x1="${r1(xa)}" y1="${r1(cy)}" x2="${r1(xb)}" y2="${r1(cy)}" stroke="${r.focus ? t.brand : t.line}" stroke-width="1.5"${r.focus ? ' class="focus"' : ''}/>`);
    x.parts.push(`<circle cx="${r1(xa)}" cy="${r1(cy)}" r="${r1(rDot)}" fill="${t.paper}" stroke="${accent}" stroke-width="1.25" data-role="before" data-value="${esc(a.text)}" data-name="${esc(r.label)}"/>`);
    x.parts.push(`<circle cx="${r1(xb)}" cy="${r1(cy)}" r="${r1(rDot)}" fill="${accent}" stroke="${accent}" stroke-width="1.25" data-role="after" data-value="${esc(b.text)}" data-name="${esc(r.label)}"/>`);
    const leftIsA = xa <= xb;
    const [lv, rv] = leftIsA ? [a, b] : [b, a];
    x.parts.push(text(Math.min(xa, xb) - rDot - F * 0.3, cy + F * 0.35, lv.text, { anchor: 'end', bold: true, fill: t.ink, cls: 'value' }));
    x.parts.push(text(Math.max(xa, xb) + rDot + F * 0.3, cy + F * 0.35, rv.text, { anchor: 'start', bold: true, fill: t.ink, cls: 'value' }));
  }
  // The unit has its own line under the tick labels, at the right edge.
  const tickBase = plotBottom + F * 1.15;
  let bottom = tickBase + F * 0.4;
  if (c.unit) { x.parts.push(text(o.widthPx, tickBase + lineH, c.unit, { anchor: 'end', fill: t.textSec, cls: 'unit' })); bottom += lineH; }
  return wrapSvg(c, x, bottom + F * 0.3);
}

// ------------------------------------------------------------------ waterfall

function drawWaterfall(c: Chart, x: Ctx): string {
  const { o, w, F, lineH } = x;
  const t = o.tokens;
  const top = titleBlock(c, x);
  const ticks = ticksOf(c);
  const tickW = Math.max(...ticks.labels.map((l) => w(l)));
  const left = tickW + F * 0.7;
  const n = c.rows.length;
  // The last value is centred on the last bar: leave it room to the right.
  const valueW = Math.max(...c.rows.map((r) => w(r.values[0]!.text, true)));
  const pitch = Math.min((o.widthPx - left) / n, (o.widthPx - left - valueW / 2 - 2) / (n - 0.5));
  const barW = pitch * 0.62;
  // Values wider than their column alternate between two rows, so two
  // neighbours never print on top of each other.
  const stagger = valueW > pitch - F * 0.4;
  const plotTop = top + lineH * (stagger ? 2.3 : 1.3);
  const plotH = F * 15;
  const base = plotTop + plotH;
  const sy = (v: number) => base - ((v - ticks.lo) / (ticks.hi - ticks.lo)) * plotH;
  ticks.values.forEach((v, i) => {
    x.parts.push(`<line x1="${r1(left)}" y1="${r1(sy(v))}" x2="${r1(o.widthPx)}" y2="${r1(sy(v))}" stroke="${t.faint}" stroke-width="1"/>`);
    x.parts.push(text(tickW, sy(v) + F * 0.35, ticks.labels[i]!, { anchor: 'end', fill: t.textSec, cls: 'tick' }));
  });
  x.parts.push(`<line x1="${r1(left)}" y1="${r1(base)}" x2="${r1(o.widthPx)}" y2="${r1(base)}" stroke="${t.stroke}" stroke-width="1"/>`);
  const levels = runningLevels(c);
  let k = 0, labelBottom = base;
  const totals = c.rows.filter((r) => r.role === 'total').length;
  c.rows.forEach((r, i) => {
    const v = r.values[0]!;
    const bx = left + pitch * i + (pitch - barW) / 2;
    let from: number, to: number;
    if (r.role === 'step') { from = levels[k++]!; to = levels[k++]!; } else { from = ticks.lo; to = levels[k++]!; }
    const yTop = sy(Math.max(from, to)), yBot = sy(Math.min(from, to));
    const role = r.role === 'total' ? (i === 0 || i === n - 1 || totals <= 2 ? 'total' : 'subtotal') : 'delta';
    x.parts.push(`<rect x="${r1(bx)}" y="${r1(yTop)}" width="${r1(barW)}" height="${r1(Math.max(yBot - yTop, 0.5))}" `
      + `${barPaint(t, v.value >= 0, r.focus, r.role === 'total')}${r.focus ? ' class="focus"' : ''} data-role="${role}" data-value="${esc(v.text)}" data-name="${esc(r.label)}"/>`);
    if (r.role === 'total' && c.axis) x.parts.push(breakMark(bx + barW / 2, base - F * 0.9, t, F));
    // value: totals and increases above, decreases below
    const down = r.role === 'step' && v.value < 0;
    const lift = stagger && i % 2 === 1 ? lineH : 0;
    const below = down && yBot + F * 1.15 + lift <= base - F * 0.25;
    const vy = below ? yBot + F * 1.15 + lift : yTop - F * 0.4 - lift;
    x.parts.push(text(bx + barW / 2, vy, v.text, { anchor: 'middle', bold: true, fill: r.focus ? t.brand : t.ink, cls: 'value' }));
    // carry: the level after this bar, across the gap to the next
    if (i < n - 1) {
      const level = r.role === 'step' ? to : to;
      x.parts.push(`<line x1="${r1(bx + barW)}" y1="${r1(sy(level))}" x2="${r1(bx + pitch)}" y2="${r1(sy(level))}" stroke="${t.line}" stroke-width="1" data-carry="${+level.toPrecision(12)}"/>`);
    }
    const lines = wrap(r.label, pitch - F * 0.3, w);
    lines.forEach((l, j) => x.parts.push(text(bx + barW / 2, base + F * 1.25 + j * lineH, l, { anchor: 'middle', fill: t.ink, cls: 'label' })));
    labelBottom = Math.max(labelBottom, base + F * 1.25 + (lines.length - 1) * lineH + F * 0.4);
  });
  let bottom = labelBottom + F * 0.6;
  if (c.unit) { x.parts.push(text(o.widthPx, bottom + F * 0.6, c.unit, { anchor: 'end', fill: t.textSec, cls: 'unit' })); bottom += lineH; }
  return wrapSvg(c, x, bottom + F * 0.3);
}

export function drawChart(c: Chart, o: DrawOptions, w: Widths): { svg: string; w: number; h: number } {
  const x: Ctx = { o, w, F: o.bodyPx, lineH: o.bodyPx * 1.3, parts: [] };
  const svg = c.kind === 'bar' || c.kind === 'grouped' ? drawBar(c, x) : c.kind === 'dumbbell' ? drawDumbbell(c, x) : drawWaterfall(c, x);
  const [, W, H] = /width="(\d+)" height="(\d+)"/.exec(svg)!;
  return { svg, w: Number(W), h: Number(H) };
}
