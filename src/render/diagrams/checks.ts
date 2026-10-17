// What a drawn diagram is checked against (docs/adr/0006). Measuring happens
// in the page, on the SVG as the browser lays it out; judging is pure, over
// the measured boxes, so each rule is tested on synthetic geometry in both
// directions. A finding is a warning: it never refuses or changes a drawing.

import type { DiagramType } from './registry.js';

export type Box = { x: number; y: number; w: number; h: number };

/** One drawing as measured in the page, in CSS pixels from its top left. */
export type Measured = {
  w: number;
  h: number;
  /** Every text with area: Mermaid writes some empty, zero-size ones.
   *  `owner` numbers the label group the text belongs to (-1: none), so the
   *  lines of one label never count as two labels overlapping. */
  texts: (Box & { s: string; owner?: number })[];
  /** Node boxes (`g.node`). */
  nodes: Box[];
  /** Edge-label boxes (`g.edgeLabel`) that hold something. */
  edgeLabels: (Box & { s: string })[];
  /** A chart's declared marks (`[data-role]`: bars and dots), which no text
   *  may sit on. Empty for a Mermaid drawing. */
  bars?: Box[];
  /** Matches per budget key, by the selector its record names. */
  counts: Record<string, number>;
  /** Elements marked as the focus (`.focus`). */
  focus: number;
};

export type Code = 'D-CLIP' | 'D-COLLIDE' | 'D-COVER' | 'D-SMALL' | 'D-BUDGET' | 'D-FOCUS' | 'D-UNRECORDED';
export type Finding = { code: Code; message: string };

/** How far two boxes overlap along each axis (negative: a gap). */
function overlap(a: Box, b: Box): [number, number] {
  return [Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)];
}

/** More than a pixel each way: anti-aliasing and rounding stay quiet. */
const TOUCH = 1;
const meets = (a: Box, b: Box) => { const [x, y] = overlap(a, b); return x > TOUCH && y > TOUCH; };
const quote = (s: string) => `"${s.length > 32 ? `${s.slice(0, 31)}…` : s}"`;

/** A few named, then a count: a finding stays one line however many hits. */
function some(items: string[], n = 3): string {
  return items.length <= n ? items.join(', ') : `${items.slice(0, n).join(', ')} and ${items.length - n} more`;
}

export function clip(m: Measured): Finding[] {
  const out = m.texts.filter((t) => t.x < -TOUCH || t.y < -TOUCH || t.x + t.w > m.w + TOUCH || t.y + t.h > m.h + TOUCH);
  return out.length === 0 ? [] : [{ code: 'D-CLIP',
    message: `${some(out.map((t) => quote(t.s)))} ${out.length === 1 ? 'runs' : 'run'} past the drawing's edge; a shorter label would keep it whole` }];
}

export function collide(m: Measured): Finding[] {
  const pairs: string[] = [];
  const same = (a: { owner?: number }, b: { owner?: number }) => a.owner !== undefined && a.owner >= 0 && a.owner === b.owner;
  m.texts.forEach((a, i) => m.texts.slice(i + 1).forEach((b) => {
    if (!same(a, b) && meets(a, b)) pairs.push(`${quote(a.s)} with ${quote(b.s)}`);
  }));
  if (pairs.length === 0) return [];
  const named = pairs.length <= 2 ? pairs.join(', ') : `${pairs.slice(0, 2).join(', ')} and ${pairs.length - 2} more pairs`;
  return [{ code: 'D-COLLIDE',
    message: `labels overlap: ${named}; shorter labels, or fewer and larger items (merged small slices, grouped months), would make them readable` }];
}

export function cover(m: Measured): Finding[] {
  const onBar = m.texts.filter((tx) => (m.bars ?? []).some((b) => meets(tx, b)));
  if (onBar.length) {
    return [{ code: 'D-COVER', message: `${some(onBar.map((tx) => quote(tx.s)))} ${onBar.length === 1 ? 'sits' : 'sit'} on a bar; `
      + 'a shorter label, or fewer rows or columns, would give it room' }];
  }
  const hit = m.edgeLabels.filter((l) => m.nodes.some((n) => meets(l, n)));
  return hit.length === 0 ? [] : [{ code: 'D-COVER',
    message: `the edge ${hit.length === 1 ? 'label' : 'labels'} ${some(hit.map((l) => quote(l.s)))} ${hit.length === 1 ? 'sits' : 'sit'} on a box; more room between the boxes or a shorter label would clear it` }];
}

export function budget(m: Measured, t: DiagramType | undefined): Finding[] {
  if (!t) return [];
  const over = Object.entries(t.budget).filter(([k, b]) => (m.counts[k] ?? 0) > b.max)
    .map(([k, b]) => `${m.counts[k]} ${k} against a budget of ${b.max}`);
  return over.length === 0 ? [] : [{ code: 'D-BUDGET',
    message: `${over.join(', ')}; an overview and a detail diagram would read better than one` }];
}

export function focus(m: Measured, t: DiagramType | undefined): Finding[] {
  const max = t?.focusMax ?? 2;
  return m.focus <= max ? [] : [{ code: 'D-FOCUS',
    message: `${m.focus} elements are marked as the focus against ${max}; the accent reads only when it is kept for what the diagram is about` }];
}

export function unrecorded(t: DiagramType | undefined, head: string): Finding[] {
  return t ? [] : [{ code: 'D-UNRECORDED',
    message: `${quote(head || 'this type')} is drawn with the shared settings only; documentor does not proof or correct it` }];
}

/** Every finding for one drawing, in a fixed order. */
export function findings(m: Measured, t: DiagramType | undefined, head: string): Finding[] {
  return [...unrecorded(t, head), ...clip(m), ...collide(m), ...cover(m), ...budget(m, t), ...focus(m, t)];
}

/** The build's line for a finding. */
export const findingLine = (n: number, kind: string, f: Finding) => `diagram ${n} (${kind}) ${f.code}: ${f.message}`;

/**
 * The in-page collector for the SVG in `#host`, as a string (this project's
 * tsconfig has no DOM lib). `counts` maps a budget key to its selector.
 */
export function measureScript(counts: Record<string, string>): string {
  return `(() => {
    const svg = document.querySelector('#host svg');
    const r0 = svg.getBoundingClientRect();
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x - r0.x, y: r.y - r0.y, w: r.width, h: r.height }; };
    const shown = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
    const filled = (b) => b.w > 0.5 && b.h > 0.5;
    const owners = new Map();
    const ownerOf = (t) => {
      const g = t.closest('g.label, g.edgeLabel, g.node, g.cluster');
      if (!g) return -1;
      if (!owners.has(g)) owners.set(g, owners.size);
      return owners.get(g);
    };
    const texts = [...svg.querySelectorAll('text')].filter((t) => t.textContent.trim() && shown(t))
      .map((t) => ({ ...box(t), s: t.textContent.trim().replace(/\\s+/g, ' '), owner: ownerOf(t) })).filter(filled);
    const nodes = [...svg.querySelectorAll('g.node')].filter(shown).map(box).filter(filled);
    const edgeLabels = [...svg.querySelectorAll('g.edgeLabel')].filter((g) => g.textContent.trim() && shown(g))
      .map((g) => ({ ...box(g), s: g.textContent.trim().replace(/\\s+/g, ' ') })).filter(filled);
    const sel = ${JSON.stringify(counts)};
    const counts = {};
    for (const k of Object.keys(sel)) counts[k] = svg.querySelectorAll(sel[k]).length;
    const bars = [...svg.querySelectorAll('[data-role]')].map(box).filter(filled);
    return { w: r0.width, h: r0.height, texts, nodes, edgeLabels, bars, counts, focus: svg.querySelectorAll('.focus').length };
  })()`;
}
