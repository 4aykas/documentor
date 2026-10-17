// An axonometric figure laid out and drawn as SVG (docs/adr/0009). Pure:
// text widths come in measured (chart/measure.ts). Every box emits its model
// geometry as data-box="x y z w d h" with the figure's scale and origin, so a
// test can reproject each silhouette with its own copy of the projection.
//
// Faces take three tones of the grey system, the top lightest; the focus
// element's top takes the brand tint. No shadows. Labels are the author's
// words: an exploded part's in one column to the right on a horizontal
// leader that starts on the part and crosses no other; a plan's rooms and
// blocks tagged on their own floor or roof, painted last.

import { mix, type DiagramTokens } from '../tokens.js';
import type { Widths } from '../chart/draw.js';
import { wrap } from '../chart/draw.js';
import type { Axo, Box, Exploded, Part, Plan, Room } from './parse.js';
import { backToFront, faces, insidePoly, project, silhouette, type Pt } from './project.js';

export type AxoOptions = { widthPx: number; bodyPx: number; family: string; tokens: DiagramTokens; id: string };
export type Drawn = { svg: string; w: number; h: number } | { error: string };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 10) / 10;
const pts = (p: Pt[], ox: number, oy: number) => p.map(([x, y]) => `${r1(x + ox)},${r1(y + oy)}`).join(' ');

/** The strings a figure may draw, for the page to measure in one pass. */
export function axoStrings(a: Axo): { regular: string[]; bold: string[] } {
  const labels = a.kind === 'exploded' ? a.parts.map((p) => p.label) : a.items.map((r) => r.label);
  const bold = new Set<string>(labels);
  const regular = new Set<string>([' ']);
  if (a.title) { bold.add(a.title); a.title.split(' ').forEach((w) => bold.add(w)); }
  return { regular: [...regular], bold: [...bold] };
}

type Tones = { top: string; right: string; left: string; line: string; width: number };

function tones(t: DiagramTokens, focus: boolean): Tones {
  return focus
    ? { top: t.tint(0.2), right: mix(t.brand, t.paper, 0.32), left: mix(t.brand, t.paper, 0.24), line: t.brand, width: 1.25 }
    : { top: mix(t.ink, t.paper, 0.04), right: mix(t.ink, t.paper, 0.17), left: mix(t.ink, t.paper, 0.1), line: t.line, width: 0.75 };
}

/** One box as its three faces, with its geometry declared. */
function boxSvg(b: Box, k: number, ox: number, oy: number, tone: Tones, attrs: string): string {
  const f = faces(b, k);
  const poly = (p: Pt[], fill: string, cls: string) =>
    `<polygon class="${cls}" points="${pts(p, ox, oy)}" fill="${fill}" stroke="${tone.line}" stroke-width="${tone.width}" stroke-linejoin="round"/>`;
  return `<g data-box="${[b.x, b.y, b.z, b.w, b.d, b.h].map((v) => +v.toPrecision(10)).join(' ')}"${attrs}>`
    + poly(f.left, tone.left, 'face-left') + poly(f.right, tone.right, 'face-right') + poly(f.top, tone.top, 'face-top') + '</g>';
}

/** Screen bounds of a set of boxes at scale 1. */
function bounds(boxes: Box[]): { minX: number; maxX: number; minY: number; maxY: number } {
  const all = boxes.flatMap((b) => silhouette(b, 1));
  return {
    minX: Math.min(...all.map((p) => p[0])), maxX: Math.max(...all.map((p) => p[0])),
    minY: Math.min(...all.map((p) => p[1])), maxY: Math.max(...all.map((p) => p[1])),
  };
}

function head(a: Axo, o: AxoOptions, w: Widths, parts: string[]): number {
  if (!a.title) return 0;
  const F = o.bodyPx, lineH = F * 1.3;
  const lines = wrap(a.title, o.widthPx, w, true);
  lines.forEach((l, i) => parts.push(`<text x="0" y="${r1(F * 1.05 + i * lineH)}" font-weight="600" fill="${o.tokens.ink}" class="axo-title">${esc(l)}</text>`));
  return lines.length * lineH + F * 0.8;
}

function wrapSvg(a: Axo, o: AxoOptions, parts: string[], h: number, scale: { k: number; ox: number; oy: number }): string {
  const { id, family, bodyPx } = o;
  const acc = (a.title ? `<title id="chart-title-${id}">${esc(a.title)}</title>` : '') + (a.desc ? `<desc id="chart-desc-${id}">${esc(a.desc)}</desc>` : '');
  const aria = `${a.title ? ` aria-labelledby="chart-title-${id}"` : ''}${a.desc ? ` aria-describedby="chart-desc-${id}"` : ''}`;
  const W = Math.ceil(o.widthPx), H = Math.ceil(h);
  return `<svg id="${id}" class="axonometric axonometric-${a.kind}" role="img"${aria} width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"`
    + ` data-k="${+scale.k.toPrecision(10)}" data-origin="${r1(scale.ox)} ${r1(scale.oy)}">`
    + `${acc}<style>#${id} text { font-family: ${family.replace(/"/g, "'")}; font-size: ${r1(bodyPx)}px; } #${id} { fill: ${o.tokens.ink}; } `
    + `#${id} line { fill: none; } #${id} title, #${id} desc { display: none; }</style>${parts.join('')}</svg>`;
}

// ------------------------------------------------------------------ exploded

function drawExploded(a: Exploded, o: AxoOptions, w: Widths): Drawn {
  const F = o.bodyPx, lineH = F * 1.3, t = o.tokens;
  const parts: string[] = [];
  const top = head(a, o, w, parts);
  // Levels in listing order, top first; each stands on the one below plus the gap.
  const order = [...new Set(a.parts.map((p) => p.level))];
  const height = (lv: number) => Math.max(...a.parts.filter((p) => p.level === lv).map((p) => p.h));
  let z = 0;
  const zOf = new Map<number, number>();
  for (const lv of [...order].reverse()) { zOf.set(lv, z); z += height(lv) + a.gap; }
  const placed: Part[] = a.parts.map((p) => ({ ...p, z: zOf.get(p.level)! }));
  const labelW = Math.max(...placed.map((p) => w(p.label, true)));
  const lead = F * 2.2;
  const avail = o.widthPx - labelW - lead;
  const b1 = bounds(placed);
  const k = Math.min(avail / (b1.maxX - b1.minX), (o.widthPx * 0.85) / (b1.maxY - b1.minY));
  if (!(k > 0) || !Number.isFinite(k)) return { error: 'the figure has no size to draw' };
  const ox = -b1.minX * k, oy = top + lineH * 0.6 - b1.minY * k;
  // Paint bottom level first, back to front within a level.
  const levelsUp = [...order].reverse();
  for (const lv of levelsUp) {
    for (const p of backToFront(placed.filter((q) => q.level === lv))) {
      parts.push(boxSvg(p, k, ox, oy, tones(t, p.focus), ` data-axo="part" data-name="${esc(p.label)}"${p.focus ? ' class="focus"' : ''}`));
    }
  }
  // Labels: one column right of the drawing. Each leader is horizontal and
  // starts on its own part's outline at a point from which the ray to the
  // label column crosses no part, its own included; of those points, the one
  // nearest the part's middle whose label clears the labels already placed.
  const labelX = (b1.maxX - b1.minX) * k + lead;
  const shapes = placed.map((p) => silhouette(p, k).map(([x, y]) => [x + ox, y + oy] as Pt));
  const clear = (x0: number, y: number) => {
    const n = Math.max(8, Math.ceil((labelX - 6 - x0) / 3));
    return Array.from({ length: n }, (_, q) => [x0 + 1.5 + ((labelX - 6 - x0 - 1.5) * q) / (n - 1), y] as Pt)
      .every((pt) => shapes.every((s) => !insidePoly(pt, s)));
  };
  const taken: number[] = [];
  const middle = (s: Pt[]) => s.reduce((a, p) => a + p[1], 0) / s.length;
  const sorted = placed.map((p, i) => ({ p, i })).sort((u, v) => middle(shapes[u.i]!) - middle(shapes[v.i]!));
  for (const { p, i } of sorted) {
    const s = shapes[i]!;
    // Points along the outline, every 2 px.
    const cand: Pt[] = s.flatMap((a, e) => {
      const b = s[(e + 1) % s.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return Array.from({ length: Math.max(2, Math.ceil(len / 2)) }, (_, q) => [a[0] + ((b[0] - a[0]) * q) / Math.ceil(len / 2), a[1] + ((b[1] - a[1]) * q) / Math.ceil(len / 2)] as Pt);
    }).filter(([x, y]) => clear(x, y) && taken.every((ty) => Math.abs(ty - y) >= lineH));
    if (cand.length === 0) {
      return { error: `line ${p.line + 1}: no horizontal leader reaches "${p.label}" without crossing a part or another label; a larger gap or fewer parts side by side would make room` };
    }
    const mid = middle(s);
    const [ex, ey] = cand.sort((u, v) => Math.abs(u[1] - mid) - Math.abs(v[1] - mid))[0]!;
    taken.push(ey);
    parts.push(`<line x1="${r1(ex)}" y1="${r1(ey)}" x2="${r1(labelX - 6)}" y2="${r1(ey)}" stroke="${p.focus ? t.brand : t.line}" stroke-width="0.75" data-leader="${esc(p.label)}"/>`);
    parts.push(`<circle cx="${r1(ex)}" cy="${r1(ey)}" r="1.6" fill="${p.focus ? t.brand : t.line}"/>`);
    parts.push(`<text x="${r1(labelX)}" y="${r1(ey + F * 0.35)}" font-weight="600" fill="${p.focus ? t.brand : t.ink}" class="axo-label">${esc(p.label)}</text>`);
  }
  const h = Math.max(oy + b1.maxY * k, ...taken.map((y) => y + lineH)) + F * 0.6;
  return { svg: wrapSvg(a, o, parts, h, { k, ox, oy }), w: Math.ceil(o.widthPx), h: Math.ceil(h) };
}

// ------------------------------------------------------------------ plan

function drawPlan(a: Plan, o: AxoOptions, w: Widths): Drawn {
  const F = o.bodyPx, lineH = F * 1.3, t = o.tokens;
  const parts: string[] = [];
  const top = head(a, o, w, parts);
  const slab = Math.max(a.plate.w, a.plate.d) * 0.012;
  const plate: Box = { x: 0, y: 0, z: -slab, w: a.plate.w, d: a.plate.d, h: slab };
  const b1 = bounds([plate, ...a.items.map((r) => ({ ...r, h: r.h }))]);
  const k = Math.min(o.widthPx / (b1.maxX - b1.minX), (o.widthPx * 0.8) / (b1.maxY - b1.minY));
  const ox = -b1.minX * k, oy = top - b1.minY * k;
  const pal = (focus: boolean) => tones(t, focus);
  parts.push(boxSvg(plate, k, ox, oy, { ...pal(false), top: t.paper, right: mix(t.ink, t.paper, 0.12), left: mix(t.ink, t.paper, 0.08) }, ' data-axo="plate"'));
  const P = (x: number, y: number, z: number) => project(x, y, z, k);
  const blocksIn = (room: Room) => a.items.filter((b) => b.kind === 'block' && b.inRoom === room.label);
  const tops = backToFront(a.items.filter((r) => r.kind === 'room' || r.inRoom === undefined));
  const wall = (p: Pt[], fill: string, tone: Tones, cls: string) =>
    `<polygon class="${cls}" points="${pts(p, ox, oy)}" fill="${fill}" stroke="${tone.line}" stroke-width="${tone.width}" stroke-linejoin="round"/>`;
  for (const r of tops) {
    const tone = pal(r.focus);
    if (r.kind === 'block') {
      parts.push(boxSvg(r, k, ox, oy, tone, ` data-axo="block" data-name="${esc(r.label)}"${r.focus ? ' class="focus"' : ''}`));
      continue;
    }
    // A room is a floor with walls cut at desk height: the floor and the
    // inside of the two back walls first, its blocks, then the outside of
    // the two front walls.
    const { x, y, w: rw, d, h } = r;
    const g = [`<g data-box="${[x, y, 0, rw, d, h].map((v) => +v.toPrecision(10)).join(' ')}" data-axo="room" data-name="${esc(r.label)}"${r.focus ? ' class="focus"' : ''}>`];
    g.push(wall([P(x, y, 0), P(x + rw, y, 0), P(x + rw, y + d, 0), P(x, y + d, 0)], r.focus ? t.tint(0.12) : mix(t.ink, t.paper, 0.03), tone, 'floor'));
    g.push(wall([P(x, y, 0), P(x, y + d, 0), P(x, y + d, h), P(x, y, h)], tone.right, tone, 'wall-back'));
    g.push(wall([P(x, y, 0), P(x + rw, y, 0), P(x + rw, y, h), P(x, y, h)], tone.left, tone, 'wall-back'));
    for (const b of backToFront(blocksIn(r))) {
      g.push(boxSvg(b, k, ox, oy, pal(b.focus), ` data-axo="block" data-name="${esc(b.label)}"${b.focus ? ' class="focus"' : ''}`));
    }
    g.push(wall([P(x + rw, y, 0), P(x + rw, y + d, 0), P(x + rw, y + d, h), P(x + rw, y, h)], tone.right, tone, 'wall-front'));
    g.push(wall([P(x, y + d, 0), P(x + rw, y + d, 0), P(x + rw, y + d, h), P(x, y + d, h)], tone.left, tone, 'wall-front'));
    g.push('</g>');
    parts.push(g.join(''));
  }
  // Tags last: each on its own floor or roof.
  for (const r of a.items) {
    const z = r.kind === 'room' ? 0 : r.z + r.h;
    const [cx, cy] = P(r.x + r.w / 2, r.y + r.d / 2, z);
    const tw = w(r.label, true);
    const bx = cx + ox, by = cy + oy;
    parts.push(`<rect x="${r1(bx - tw / 2 - 3)}" y="${r1(by - F * 0.75)}" width="${r1(tw + 6)}" height="${r1(F * 1.1)}" rx="2" fill="${t.paper}" fill-opacity="0.88" class="axo-tag-ground"/>`);
    parts.push(`<text x="${r1(bx)}" y="${r1(by + F * 0.12)}" text-anchor="middle" font-weight="600" fill="${r.focus ? t.brand : t.ink}" class="axo-tag">${esc(r.label)}</text>`);
  }
  const h = oy + b1.maxY * k + F * 0.6;
  return { svg: wrapSvg(a, o, parts, h, { k, ox, oy }), w: Math.ceil(o.widthPx), h: Math.ceil(h) };
}

export function drawAxo(a: Axo, o: AxoOptions, w: Widths): Drawn {
  return a.kind === 'exploded' ? drawExploded(a, o, w) : drawPlan(a, o, w);
}
