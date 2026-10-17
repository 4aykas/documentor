import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { ingestMarkdown } from '../../src/ingest/md.js';
import type { Block } from '../../src/ir/types.js';
import { parseAxo } from '../../src/render/diagrams/axonometric/parse.js';
import { drawDiagrams } from '../../src/render/diagrams/index.js';
import { loadTheme } from '../../src/theme/resolve.js';

// The ```axonometric engine (docs/adr/0009). Geometry that cannot stand is
// refused; what is drawn is re-derived from its own declarations with this
// file's own copy of the projection: every face where its box puts it, every
// leader horizontal, on its own part and clear of every other, every box
// painted after the boxes wholly behind it.

describe('parseAxo', () => {
  const refused = (s: string) => { const p = parseAxo(s); expect(p.ok, s).toBe(false); return p.ok ? '' : p.error; };
  it('reads both types', () => {
    const e = parseAxo('exploded\npart Lid 10 x 8 x 1\npart Body 10 x 8 x 4 focus\n');
    expect(e.ok && e.axo.kind === 'exploded' && e.axo.parts.map((p) => [p.label, p.focus])).toEqual([['Lid', false], ['Body', true]]);
    expect(e.ok && e.axo.kind === 'exploded' && new Set(e.axo.parts.map((p) => p.level)).size).toBe(2);
    const p = parseAxo('plan\nplate 10 x 10\nroom Hall 0 0 10 x 5\nblock Desk 1 1 2 x 1 h 0.8 in Hall\n');
    expect(p.ok && p.axo.kind === 'plan' && p.axo.items.map((r) => [r.kind, r.label, r.inRoom ?? ''])).toEqual([['room', 'Hall', ''], ['block', 'Desk', 'Hall']]);
  });

  it('refuses geometry that cannot stand, naming the line', () => {
    expect(refused('exploded\npart Lid 10 x 0 x 1\n')).toMatch(/^line 2: a part has a size above zero/);
    expect(refused('plan\nroom A 0 0 5 x 5\n')).toMatch(/needs "plate/);
    expect(refused('plan\nplate 10 x 10\nroom A 8 0 5 x 5\n')).toMatch(/^line 3: room "A" does not stand on the plate/);
    expect(refused('plan\nplate 10 x 10\nroom A 0 0 5 x 5\nroom B 4 0 5 x 5\n')).toMatch(/^line 4: room "B" overlaps "A"/);
    expect(refused('plan\nplate 10 x 10\nblock A 0 0 5 x 5 h 1\nblock B 4 4 5 x 5 h 1\n')).toMatch(/block "B" overlaps "A"/);
    expect(refused('plan\nplate 10 x 10\nroom Hall 0 0 5 x 5\nblock Desk 4 4 3 x 3 h 1 in Hall\n')).toMatch(/is not inside "Hall"/);
    expect(refused('plan\nplate 10 x 10\nblock Desk 1 1 1 x 1 h 1 in Attic\n')).toMatch(/no room is called "Attic"/);
    expect(refused('plan\nplate 10 x 10\nblock Desk 1 1 1 x 1\n')).toMatch(/needs its height/);
    expect(refused('plan\nplate 10 x 10\nplate 5 x 5\nroom A 0 0 1 x 1\n')).toMatch(/plate is set twice/);
    expect(refused('exploded\npart Lid 10 x 8 x 1 colour red\n')).toMatch(/"colour" is not a part option/);
  });

  it('refuses what the review found it accepted (2026-10-17)', () => {
    // A block standing in a room without saying so would vanish under its floor.
    expect(refused('plan\nplate 10 x 10\nblock Desk 3 3 4 x 2 h 0.8\nroom Hall 0 0 10 x 10\n')).toMatch(/stands in "Hall" without saying so/);
    // Two rooms of one name: a block "in" one could not say which.
    expect(refused('plan\nplate 20 x 10\nroom Hall 0 0 5 x 5\nroom Hall 10 0 5 x 5\n')).toMatch(/two rooms are called "Hall"/);
    // Parts side by side inside each other.
    expect(refused('exploded\npart A 60 x 70 x 30 level 2\npart B 50 x 70 x 30 level 2 at 5 0\n')).toMatch(/overlaps "A" on their level/);
    expect(refused('plan\nplate 10 x 10\nblock Desk 1 1 1 x 1 h 1 h 2\n')).toMatch(/h is given twice/);
    expect(refused('plan\nplate 10 x 10\nblock Desk 1 1 1 x 1 h 0\n')).toMatch(/h takes a height above zero/);
  });

  it('never merges a part without a level into another part\'s level', () => {
    const e = parseAxo('exploded\npart A 10 x 8 x 1 level 1\npart B 10 x 8 x 1\npart C 10 x 8 x 1 level 2\n');
    expect(e.ok && e.axo.kind === 'exploded' && new Set(e.axo.parts.map((p) => p.level)).size).toBe(3);
  });
});

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

type Diagram = Extract<Block, { t: 'diagram' }>;
type Pt = [number, number];

async function drawn(fence: string, themeId = 'plain', warn: string[] = []): Promise<Diagram | undefined> {
  const doc = await drawDiagrams(ingestMarkdown(`\`\`\`axonometric\n${fence}\n\`\`\`\n`).doc, await loadTheme(themeId), browser, (m) => warn.push(m));
  return doc.blocks.find((b): b is Diagram => b.t === 'diagram');
}

/** Everything a figure declares, read back from its SVG in the page. */
async function readBack(svg: string) {
  const page = await browser.newPage();
  try {
    await page.setContent(`<div id="host">${svg}</div>`);
    return await page.evaluate(`(() => {
      const s = document.querySelector('#host svg');
      const pts = (el) => el.getAttribute('points').split(' ').map((p) => p.split(',').map(Number));
      return {
        k: +s.dataset.k, origin: s.dataset.origin.split(' ').map(Number),
        groups: [...s.querySelectorAll('g[data-box]')].map((g, order) => ({
          order, axo: g.dataset.axo, name: g.dataset.name || '', box: g.dataset.box.split(' ').map(Number),
          faces: Object.fromEntries([...g.querySelectorAll(':scope > polygon')].map((p) => [p.getAttribute('class'), pts(p)])),
        })),
        leaders: [...s.querySelectorAll('line[data-leader]')].map((l) => ({ name: l.dataset.leader,
          x1: +l.getAttribute('x1'), y1: +l.getAttribute('y1'), x2: +l.getAttribute('x2'), y2: +l.getAttribute('y2') })),
        texts: [...s.querySelectorAll('text')].map((t) => t.textContent),
      };
    })()`) as { k: number; origin: [number, number]; groups: { order: number; axo: string; name: string; box: number[]; faces: Record<string, Pt[]> }[];
      leaders: { name: string; x1: number; y1: number; x2: number; y2: number }[]; texts: string[] };
  } finally {
    await page.close();
  }
}

// This file's own projection, written apart from project.ts on purpose.
const proj = (k: number, [ox, oy]: [number, number]) => (x: number, y: number, z: number): Pt => [(x - y) * k + ox, ((x + y) / 2 - z) * k + oy];
const outline = (P: ReturnType<typeof proj>, [x, y, z, w, d, h]: number[]): Pt[] =>
  [P(x!, y!, z! + h!), P(x! + w!, y!, z! + h!), P(x! + w!, y!, z!), P(x! + w!, y! + d!, z!), P(x!, y! + d!, z!), P(x!, y! + d!, z! + h!)];
const inside = (p: Pt, poly: Pt[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const onOutline = (p: Pt, poly: Pt[]) => poly.some((a, i) => {
  const b = poly[(i + 1) % poly.length]!;
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]) < 0.6;
});
const near = (a: Pt[], b: Pt[]) => a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i]![0]) < 0.15 && Math.abs(p[1] - b[i]![1]) < 0.15);

const EXPLODED = 'exploded\ntitle Air handling unit\ndesc Four parts, roof on top.\npart Roof panel 120 x 80 x 6\npart Fan section 60 x 70 x 30 level 2 at 0 5\npart Coil section 50 x 70 x 30 level 2 at 65 5 focus\npart Base frame 120 x 80 x 12';
const PLAN = 'plan\ntitle Plant room\nplate 34 x 20\nroom Switchroom 4 0 8 x 8\nroom Plant hall 12 0 18 x 20 focus\nroom Store 0 8 12 x 12\nblock Chiller 16 4 8 x 4 h 2.5 in Plant hall\nblock Pumps 16 12 6 x 3 h 1 in Plant hall\nblock Tank 0 0 3 x 3 h 2';


describe.each([['exploded', EXPLODED], ['plan', PLAN]])('a drawn %s', (_, fence) => {
  it('puts every face where its declared box projects', async () => {
    const r = await readBack((await drawn(fence))!.svg);
    const P = proj(r.k, r.origin);
    expect(r.groups.length).toBeGreaterThan(2);
    for (const g of r.groups) {
      const [x, y, z, w, d, h] = g.box as [number, number, number, number, number, number];
      if (g.axo === 'room') {
        expect(near(g.faces['floor']!, [P(x, y, 0), P(x + w, y, 0), P(x + w, y + d, 0), P(x, y + d, 0)]), `${g.name} floor`).toBe(true);
        expect(near(g.faces['wall-front']!, [P(x, y + d, 0), P(x + w, y + d, 0), P(x + w, y + d, h), P(x, y + d, h)]), `${g.name} front wall`).toBe(true);
        expect(near(g.faces['wall-back']!, [P(x, y, 0), P(x + w, y, 0), P(x + w, y, h), P(x, y, h)]), `${g.name} back wall`).toBe(true);
        continue;
      }
      expect(near(g.faces['face-top']!, [P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)]), `${g.name} top`).toBe(true);
      expect(near(g.faces['face-right']!, [P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)]), `${g.name} right`).toBe(true);
      expect(near(g.faces['face-left']!, [P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)]), `${g.name} left`).toBe(true);
    }
  });

  it('paints every box after the boxes wholly behind it that it overlaps on screen', async () => {
    const r = await readBack((await drawn(fence))!.svg);
    const P = proj(r.k, r.origin);
    const solids = r.groups.filter((g) => g.axo === 'part' || g.axo === 'block' || g.axo === 'room');
    for (const a of solids) {
      for (const b of solids) {
        if (a === b || a.box[2] !== b.box[2]) continue;
        const [ax, ay, , aw, ad] = a.box as number[], [bx, by, , bw, bd] = b.box as number[];
        const behind = ax! + aw! <= bx! + 1e-9 || ay! + ad! <= by! + 1e-9;
        const meets = outline(P, a.box).some((p) => inside(p, outline(P, b.box))) || outline(P, b.box).some((p) => inside(p, outline(P, a.box)));
        const within = (u: number[], v: number[]) => u[0]! >= v[0]! && u[1]! >= v[1]! && u[0]! + u[3]! <= v[0]! + v[3]! && u[1]! + u[4]! <= v[1]! + v[4]!;
        const nested = (a.axo === 'room' && within(b.box, a.box)) || (b.axo === 'room' && within(a.box, b.box));
        if (behind && meets && !nested) expect(a.order, `${a.name} before ${b.name}`).toBeLessThan(b.order);
      }
    }
  });

  it('carries every label and its title and description', async () => {
    const d = (await drawn(fence))!;
    const r = await readBack(d.svg);
    const names = r.groups.filter((g) => g.name).map((g) => g.name);
    for (const n of names) expect(r.texts, n).toContain(n);
    expect(r.texts).toContain(d.title);
  });
});

describe.each(['plain', 'dark-sheet'])('the faces under %s', (themeId) => {
  // Light from above: the top is the lightest face and the right the
  // darkest, on a dark sheet as on a light one.
  it('shade top lightest, right darkest', async () => {
    const d = (await drawn(EXPLODED, themeId))!;
    const page = await browser.newPage();
    try {
      await page.setContent(`<div id="host">${d.svg}</div>`);
      const lum = await page.evaluate(`[...document.querySelectorAll('#host g[data-axo="part"]:not(.focus)')].map((g) => {
        const l = (c) => { const [r, gg, b] = c.match(/\\d+/g).map(Number).map((v) => v / 255); return 0.2126 * r + 0.7152 * gg + 0.0722 * b; };
        const f = (cls) => l(getComputedStyle(g.querySelector('.' + cls)).fill);
        return [f('face-top'), f('face-left'), f('face-right')];
      })`) as [number, number, number][];
      expect(lum.length).toBeGreaterThan(0);
      for (const [top, left, right] of lum) { expect(top).toBeGreaterThan(left); expect(left).toBeGreaterThan(right); }
    } finally {
      await page.close();
    }
  });
});

describe('a plan\'s tags', () => {
  it('are warned about when a name cannot fit its room', async () => {
    const warn: string[] = [];
    await drawn('plan\nplate 10 x 4\nroom Corridor connecting the east wing 0 0 3 x 2\nroom WC 3 0 2 x 2', 'plain', warn);
    // A finding quotes a long name to 32 characters.
    expect(warn.join('\n')).toMatch(/D-COVER: .*"Corridor connecting the east wi…" runs past its room/);
  });

  it('step around a block in the middle of their room', async () => {
    const warn: string[] = [];
    await drawn('plan\nplate 20 x 14\nroom Plant hall 0 0 20 x 14\nblock Chiller 7 5 6 x 4 h 2.5 in Plant hall', 'plain', warn);
    expect(warn.filter((m) => / D-/.test(m))).toEqual([]);
  });
});

describe('an exploded figure\'s leaders', () => {
  it('are horizontal, start on their own part, and cross no part', async () => {
    const r = await readBack((await drawn(EXPLODED))!.svg);
    const P = proj(r.k, r.origin);
    const shapes = new Map(r.groups.map((g) => [g.name, outline(P, g.box)]));
    expect(r.leaders).toHaveLength(4);
    for (const l of r.leaders) {
      expect(l.y1, l.name).toBe(l.y2);
      expect(onOutline([l.x1, l.y1], shapes.get(l.name)!), `${l.name} starts on its part`).toBe(true);
      for (let q = 1; q <= 60; q++) {
        const p: Pt = [l.x1 + 1.5 + ((l.x2 - l.x1 - 1.5) * q) / 60, l.y1];
        for (const [name, s] of shapes) expect(inside(p, s), `${l.name} crosses ${name}`).toBe(false);
      }
    }
  });
});

// Generated figures: plans on a grid of rooms with furniture, and stacks of
// parts with some side by side, in a light and a dark theme.
describe.each(['plain', 'dark-sheet'])('figures the parser accepts, under %s', (themeId) => {
  it('draw no clipped, colliding or covered label', async () => {
    let seed = themeId.length * 104729;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    const n = (lo: number, hi: number) => Math.round(lo + rnd() * (hi - lo));
    const names = ['Hall', 'Office', 'Store', 'Plant', 'Lab', 'Kitchen', 'Server', 'Lobby'];
    const fences: string[] = [];
    for (let k = 0; k < 5; k++) {
      const cols = n(1, 3), rows = n(1, 2);
      const cw = n(9, 14), cd = n(7, 10);
      const lines = [`plan\ntitle Generated plan ${k}\nplate ${cols * cw} x ${rows * cd}`];
      let id = 0;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const room = `${names[id % names.length]} ${id + 1}`;
          lines.push(`room ${room} ${c * cw} ${r * cd} ${cw} x ${cd}${rnd() < 0.15 ? ' focus' : ''}`);
          if (rnd() < 0.6) lines.push(`block Unit ${id + 1} ${c * cw + 1} ${r * cd + cd - 3} 3 x 2 h ${n(1, 3)} in ${room}`);
          id++;
        }
      }
      fences.push(lines.join('\n'));
      const parts = [`exploded\ntitle Generated stack ${k}`, `part Top ${n(60, 140)} x ${n(40, 90)} x ${n(4, 10)}`];
      if (rnd() < 0.6) parts.push(`part Left module 40 x 50 x 20 level 2 at 0 5`, `part Right module 40 x 50 x 20 level 2 at 50 5`);
      parts.push(`part Base ${n(90, 140)} x ${n(60, 90)} x ${n(10, 30)}${rnd() < 0.3 ? ' focus' : ''}`);
      fences.push(parts.join('\n'));
    }
    const warn: string[] = [];
    const md = fences.map((f) => `\`\`\`axonometric\n${f}\n\`\`\``).join('\n\n') + '\n';
    const doc = await drawDiagrams(ingestMarkdown(md).doc, await loadTheme(themeId), browser, (m) => warn.push(m));
    expect(warn.filter((w) => /could not be drawn/.test(w))).toEqual([]);
    expect(doc.blocks.filter((b) => b.t === 'diagram')).toHaveLength(fences.length);
    expect(warn.filter((w) => / D-(CLIP|COLLIDE|COVER):/.test(w))).toEqual([]);
  }, 180_000);
});
