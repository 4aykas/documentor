// The one projection every axonometric figure uses, and the order its boxes
// paint in (docs/adr/0009). 2:1 dimetric: model x runs right and down, y runs
// left and down, z up; one model unit is k pixels across.

import type { Box } from './parse.js';

export type Pt = [number, number];

export const project = (x: number, y: number, z: number, k: number): Pt => [(x - y) * k, ((x + y) / 2 - z) * k];

/** The three faces a box shows the viewer, each a closed polygon. The
 *  viewer looks from +x, +y, above: the top, the face at x + w (right), and
 *  the face at y + d (left). */
export function faces(b: Box, k: number): { top: Pt[]; right: Pt[]; left: Pt[] } {
  const p = (x: number, y: number, z: number) => project(x, y, z, k);
  const { x, y, z, w, d, h } = b;
  return {
    top: [p(x, y, z + h), p(x + w, y, z + h), p(x + w, y + d, z + h), p(x, y + d, z + h)],
    right: [p(x + w, y, z), p(x + w, y + d, z), p(x + w, y + d, z + h), p(x + w, y, z + h)],
    left: [p(x, y + d, z), p(x + w, y + d, z), p(x + w, y + d, z + h), p(x, y + d, z + h)],
  };
}

/** A box's screen outline: the hexagon its three faces make. */
export function silhouette(b: Box, k: number): Pt[] {
  const p = (x: number, y: number, z: number) => project(x, y, z, k);
  const { x, y, z, w, d, h } = b;
  return [p(x, y, z + h), p(x + w, y, z + h), p(x + w, y, z), p(x + w, y + d, z), p(x, y + d, z), p(x, y + d, z + h)];
}

/**
 * Back-to-front order over footprints, as a topological sort: A paints
 * before B when A lies wholly behind B along x or along y. A sort on x + y
 * alone draws a long wall over the desk in front of it. Boxes that are not
 * ordered either way keep their listing order; a cycle (which separated
 * footprints cannot make) falls back to x + y.
 */
export function backToFront<T extends Box>(boxes: T[]): T[] {
  const behind = (a: Box, b: Box) => a.x + a.w <= b.x + 1e-9 || a.y + a.d <= b.y + 1e-9;
  const n = boxes.length;
  const before = boxes.map(() => new Set<number>());
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a !== b && behind(boxes[a]!, boxes[b]!) && !behind(boxes[b]!, boxes[a]!)) before[b]!.add(a);
    }
  }
  const out: T[] = [];
  const done = new Set<number>();
  while (out.length < n) {
    const ready = boxes.map((_, i) => i).filter((i) => !done.has(i) && [...before[i]!].every((j) => done.has(j)));
    const pick = ready.length ? ready[0]! : boxes.map((_, i) => i).filter((i) => !done.has(i))
      .sort((a, b) => boxes[a]!.x + boxes[a]!.y - (boxes[b]!.x + boxes[b]!.y))[0]!;
    done.add(pick);
    out.push(boxes[pick]!);
  }
  return out;
}

/** Whether a point lies inside a polygon (even-odd). */
export function insidePoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
