// An ```axonometric fence read into a model (docs/adr/0009): `exploded`, one
// object with its parts lifted apart, or `plan`, a floor or a site seen from
// above at an angle. Geometry is declared, never guessed: a part or a room is
// a box with a footprint and a height in the author's model units. A line the
// parser cannot read, or geometry that cannot stand (a room off its plate,
// two rooms on one floor), refuses the fence, naming the line.

export type AxoKind = 'exploded' | 'plan';
export const AXO_KINDS: readonly AxoKind[] = ['exploded', 'plan'];

/** A box in model units: footprint at (x, y) of w × d, standing at z, h tall. */
export type Box = { x: number; y: number; z: number; w: number; d: number; h: number };

export type Part = Box & { label: string; level: number; focus: boolean; line: number };
export type Room = Box & { label: string; focus: boolean; line: number; kind: 'room' | 'block'; inRoom?: string };

export type Exploded = { kind: 'exploded'; title?: string; desc?: string; gap: number; parts: Part[] };
export type Plan = { kind: 'plan'; title?: string; desc?: string; plate: { w: number; d: number }; items: Room[] };
export type Axo = Exploded | Plan;

export type Parsed = { ok: true; axo: Axo } | { ok: false; error: string };

/** Settings and element words each type reads; the reference's keyword table
 *  is checked against these. */
export const AXO_SETTINGS: Readonly<Record<AxoKind, readonly string[]>> = {
  exploded: ['title', 'desc', 'gap'],
  plan: ['title', 'desc', 'plate'],
};
export const AXO_ELEMENTS: Readonly<Record<AxoKind, readonly string[]>> = {
  exploded: ['part'],
  plan: ['room', 'block'],
};
/** Words an element line may end with. */
export const AXO_OPTIONS: Readonly<Record<AxoKind, readonly string[]>> = {
  exploded: ['level', 'at', 'focus'],
  plan: ['h', 'in', 'focus'],
};

const NUM = /^\d+(?:\.\d+)?$/;
const num = (s: string | undefined) => (s !== undefined && NUM.test(s) ? Number(s) : null);

/** Default height of a room's walls, cut at desk height as on a floor plan. */
export const WALL_H = 1.2;

export function parseAxo(source: string): Parsed {
  const lines = source.split('\n');
  const fail = (line: number, why: string): Parsed => ({ ok: false, error: `line ${line + 1}: ${why}` });
  const skip = (l: string) => l.trim() === '' || l.trim().startsWith('%%');
  let i = 0;
  while (i < lines.length && skip(lines[i]!)) i++;
  const head = lines[i]?.trim() ?? '';
  if (!(AXO_KINDS as readonly string[]).includes(head)) {
    return fail(i, `an axonometric figure starts with its type, one of ${AXO_KINDS.join(', ')}; got ${JSON.stringify(head)}`);
  }
  const kind = head as AxoKind;
  const seen = new Set<string>();
  const text: { title?: string; desc?: string } = {};
  let gap = 0;
  let plate: { w: number; d: number } | undefined;
  const parts: Part[] = [];
  const items: Room[] = [];
  for (let n = i + 1; n < lines.length; n++) {
    const line = lines[n]!;
    if (skip(line)) continue;
    const t = line.trim().split(/[ \t]+/);
    const word = t[0]!;
    const rest = line.trim().slice(word.length).trim();
    if (AXO_SETTINGS[kind].includes(word)) {
      if (seen.has(word)) return fail(n, `${word} is set twice`);
      seen.add(word);
      if (word === 'title' || word === 'desc') {
        if (!rest) return fail(n, `${word} needs text`);
        text[word] = rest;
      } else if (word === 'gap') {
        const g = num(rest);
        if (g === null) return fail(n, `gap takes one number, got ${JSON.stringify(rest)}`);
        gap = g;
      } else {
        const m = /^(\S+)\s+x\s+(\S+)$/.exec(rest);
        const [w, d] = [num(m?.[1]), num(m?.[2])];
        if (w === null || d === null || w <= 0 || d <= 0) return fail(n, 'plate takes its size, "<width> x <depth>"');
        plate = { w, d };
      }
      continue;
    }
    if (!AXO_ELEMENTS[kind].includes(word)) {
      return fail(n, `a ${kind} line is ${[...AXO_SETTINGS[kind], ...AXO_ELEMENTS[kind]].join(', ')}; got ${JSON.stringify(word)}`);
    }
    const r = kind === 'exploded' ? partLine(t.slice(1), n) : roomLine(word as 'room' | 'block', t.slice(1), n);
    if (typeof r === 'string') return fail(n, r);
    if (kind === 'exploded') parts.push(r as Part); else items.push(r as Room);
  }
  if (kind === 'exploded') {
    if (parts.length === 0) return fail(lines.length - 1, 'an exploded figure needs at least one part');
    // A footprint W × D is (W + D) / 2 deep on screen; lifting each level by
    // most of that keeps the levels apart, so a part beside another still
    // has a clear way out for its leader.
    if (!seen.has('gap')) gap = (Math.max(...parts.map((p) => p.w)) + Math.max(...parts.map((p) => p.d))) / 2 * 0.8;
    return { ok: true, axo: { kind, ...text, gap, parts: placeParts(parts) } };
  }
  if (!plate) return fail(i, 'a plan needs "plate <width> x <depth>" for its floor or site');
  if (items.length === 0) return fail(lines.length - 1, 'a plan needs at least one room or block');
  const err = checkPlan(plate, items);
  if (err) return { ok: false, error: err };
  return { ok: true, axo: { kind, ...text, plate, items } };
}

/** `<label…> <w> x <d> x <h> [level n] [at x y] [focus]` */
function partLine(t: string[], line: number): Part | string {
  const at = t.findIndex((_, k) => num(t[k]) !== null && t[k + 1] === 'x' && num(t[k + 2]) !== null && t[k + 3] === 'x' && num(t[k + 4]) !== null);
  if (at < 1) return 'a part is "part <label> <width> x <depth> x <height>"';
  const [w, d, h] = [num(t[at]), num(t[at + 2]), num(t[at + 4])] as number[];
  if (!(w! > 0 && d! > 0 && h! > 0)) return 'a part has a size above zero in every direction';
  const part: Part = { label: t.slice(0, at).join(' '), x: Number.NaN, y: Number.NaN, z: 0, w: w!, d: d!, h: h!, level: Number.NaN, focus: false, line };
  for (let k = at + 5; k < t.length; k++) {
    const o = t[k];
    if (o === 'focus') part.focus = true;
    else if (o === 'level' && num(t[k + 1]) !== null) part.level = num(t[++k])!;
    else if (o === 'at' && num(t[k + 1]) !== null && num(t[k + 2]) !== null) { part.x = num(t[++k])!; part.y = num(t[++k])!; }
    else return `${JSON.stringify(o)} is not a part option (level <n>, at <x> <y>, focus)`;
  }
  return part;
}

/** `room|block <label…> <x> <y> <w> x <d> [h <h>] [in <room label…>] [focus]` */
function roomLine(kind: 'room' | 'block', t: string[], line: number): Room | string {
  const at = t.findIndex((_, k) => num(t[k]) !== null && num(t[k + 1]) !== null && num(t[k + 2]) !== null && t[k + 3] === 'x' && num(t[k + 4]) !== null);
  if (at < 1) return `a ${kind} is "${kind} <label> <x> <y> <width> x <depth>"`;
  const [x, y, w, d] = [num(t[at]), num(t[at + 1]), num(t[at + 2]), num(t[at + 4])] as number[];
  if (!(w! > 0 && d! > 0)) return `a ${kind} has a footprint above zero`;
  const room: Room = { kind, label: t.slice(0, at).join(' '), x: x!, y: y!, z: 0, w: w!, d: d!, h: kind === 'room' ? WALL_H : Number.NaN, focus: false, line };
  for (let k = at + 5; k < t.length; k++) {
    const o = t[k];
    if (o === 'focus') room.focus = true;
    else if (o === 'h' && num(t[k + 1]) !== null && num(t[k + 1])! > 0) room.h = num(t[++k])!;
    else if (o === 'in' && kind === 'block' && k + 1 < t.length) {
      const end = t.at(-1) === 'focus' ? t.length - 1 : t.length;
      room.inRoom = t.slice(k + 1, end).join(' ');
      k = end - 1;
    } else return `${JSON.stringify(o)} is not a ${kind} option (h <height>${kind === 'block' ? ', in <room>' : ''}, focus)`;
  }
  if (kind === 'block' && Number.isNaN(room.h)) return 'a block needs its height, "h <height>"';
  return room;
}

/**
 * Levels and positions for an exploded figure. A part without `level` has
 * one of its own, in listing order, top first; parts sharing a level sit
 * side by side and lift together. A part without `at` is centred on the
 * widest footprint.
 */
function placeParts(parts: Part[]): Part[] {
  let next = 1;
  const levelOf = new Map<number, number>();
  for (const p of parts) {
    if (Number.isNaN(p.level)) { while (levelOf.has(next)) next++; p.level = next++; }
    if (!levelOf.has(p.level)) levelOf.set(p.level, levelOf.size);
  }
  const W = Math.max(...parts.map((p) => p.w)), D = Math.max(...parts.map((p) => p.d));
  for (const p of parts) {
    if (Number.isNaN(p.x)) { p.x = (W - p.w) / 2; p.y = (D - p.d) / 2; }
  }
  return parts;
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.d - 1e-9 && b.y < a.y + a.d - 1e-9;
const inside = (a: Box, b: { x: number; y: number; w: number; d: number }) =>
  a.x >= b.x - 1e-9 && a.y >= b.y - 1e-9 && a.x + a.w <= b.x + b.w + 1e-9 && a.y + a.d <= b.y + b.d + 1e-9;

/** A plan stands or is refused: everything on the plate, no two rooms or two
 *  blocks sharing floor, a block inside the room it names. */
function checkPlan(plate: { w: number; d: number }, items: Room[]): string | null {
  const at = (r: Room) => `line ${r.line + 1}`;
  const plateBox = { x: 0, y: 0, w: plate.w, d: plate.d };
  for (const r of items) if (!inside(r, plateBox)) return `${at(r)}: ${r.kind} "${r.label}" does not stand on the plate (${plate.w} x ${plate.d})`;
  for (const kind of ['room', 'block'] as const) {
    const of = items.filter((r) => r.kind === kind);
    for (let a = 0; a < of.length; a++) {
      for (let b = a + 1; b < of.length; b++) {
        if (overlaps(of[a]!, of[b]!)) return `${at(of[b]!)}: ${kind} "${of[b]!.label}" overlaps "${of[a]!.label}"`;
      }
    }
  }
  for (const b of items.filter((r) => r.inRoom !== undefined)) {
    const room = items.find((r) => r.kind === 'room' && r.label === b.inRoom);
    if (!room) return `${at(b)}: no room is called "${b.inRoom}"`;
    if (!inside(b, room)) return `${at(b)}: block "${b.label}" is not inside "${room.label}"`;
  }
  return null;
}
