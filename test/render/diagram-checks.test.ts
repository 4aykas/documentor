import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { budget, clip, collide, cover, findings, focus, measureScript, unrecorded, type Measured } from '../../src/render/diagrams/checks.js';
import { REGISTRY, diagramTokens, drawDiagrams, typeByHead } from '../../src/render/diagrams/index.js';
import { loadTheme } from '../../src/theme/resolve.js';

// The checks on a drawn diagram (docs/adr/0006). The rules are judged on
// synthetic boxes, each in both directions; then every fault Mermaid can be
// made to produce raises exactly its code, the gallery raises none, and every
// budget selector counts something on the gallery — a selector that matches
// nothing would pass every budget silently.

const read = (f: string) => readFileSync(fileURLToPath(new URL(`../fixtures/${f}`, import.meta.url)), 'utf8');
const GALLERY = read('diagram-gallery.md');
const FAULTS = read('diagram-faults.md');

const base: Measured = { w: 200, h: 100, texts: [], nodes: [], edgeLabels: [], counts: {}, focus: 0 };
const flowchart = typeByHead('flowchart')!;
const codes = (warn: string[], n: number) => warn.flatMap((w) => {
  const m = new RegExp(`^diagram ${n} \\([^)]+\\) (D-[A-Z]+):`).exec(w);
  return m ? [m[1]!] : [];
});

describe('the rules, on synthetic boxes', () => {
  it('D-CLIP: a text past the edge, not one inside it or a pixel over', () => {
    expect(clip({ ...base, texts: [{ x: 150, y: 10, w: 60, h: 12, s: 'long' }] })).toHaveLength(1);
    expect(clip({ ...base, texts: [{ x: 140, y: 10, w: 60.8, h: 12, s: 'fits' }] })).toEqual([]);
  });

  it('D-COLLIDE: two texts overlapping, not two that touch', () => {
    const a = { x: 10, y: 10, w: 50, h: 12, s: 'a' };
    expect(collide({ ...base, texts: [a, { ...a, x: 40, s: 'b' }] })).toHaveLength(1);
    expect(collide({ ...base, texts: [a, { ...a, x: 59.5, s: 'b' }] })).toEqual([]);
  });

  it('D-COLLIDE: two lines of one label are one label', () => {
    const a = { x: 10, y: 10, w: 50, h: 12, s: 'first line', owner: 3 };
    expect(collide({ ...base, texts: [a, { ...a, y: 18, s: 'second line' }] })).toEqual([]);
    expect(collide({ ...base, texts: [a, { ...a, y: 18, s: 'other label', owner: 4 }] })).toHaveLength(1);
  });

  it('D-COVER: an edge label on a node, not one beside it', () => {
    const node = { x: 0, y: 0, w: 80, h: 40 };
    expect(cover({ ...base, nodes: [node], edgeLabels: [{ x: 70, y: 10, w: 30, h: 14, s: 'yes' }] })).toHaveLength(1);
    expect(cover({ ...base, nodes: [node], edgeLabels: [{ x: 84, y: 10, w: 30, h: 14, s: 'yes' }] })).toEqual([]);
  });

  it('D-BUDGET: a count above its max, not one at it', () => {
    expect(budget({ ...base, counts: { nodes: 10, edges: 3 } }, flowchart)).toHaveLength(1);
    expect(budget({ ...base, counts: { nodes: 9, edges: 12 } }, flowchart)).toEqual([]);
  });

  it('D-FOCUS: more focus marks than the type allows, not as many', () => {
    expect(focus({ ...base, focus: 3 }, flowchart)).toHaveLength(1);
    expect(focus({ ...base, focus: 2 }, flowchart)).toEqual([]);
  });

  it('D-UNRECORDED: a type no record claims, not a recorded one', () => {
    expect(unrecorded(undefined, 'packet-beta')).toHaveLength(1);
    expect(unrecorded(flowchart, 'flowchart')).toEqual([]);
  });

  it('reports nothing for a clean drawing', () => {
    expect(findings({ ...base, texts: [{ x: 10, y: 10, w: 40, h: 12, s: 'ok' }] }, flowchart, 'flowchart')).toEqual([]);
  });
});

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

describe('the fault fixtures', () => {
  it('raise exactly the code each is headed with', async () => {
    const expected = [...FAULTS.matchAll(/^## (D-[A-Z]+)$/gm)].map((m) => m[1]!);
    expect(expected.length).toBeGreaterThan(0);
    const warn: string[] = [];
    await drawDiagrams(ingestMarkdown(FAULTS).doc, await loadTheme('plain'), browser, (m) => warn.push(m));
    expect(expected.map((_, i) => codes(warn, i + 1)), warn.join('\n')).toEqual(expected.map((c) => [c]));
  });
});

describe('D-SMALL advice', () => {
  // The tall branch must not tell a flow written left to right (and turned
  // top-down by documentor) to go left to right.
  it('offers a left-to-right direction only to a top-down flow', async () => {
    const steps = (dir: string) => `\`\`\`mermaid\nflowchart ${dir}\n${Array.from({ length: 14 }, (_, i) =>
      `  S${i}[Step ${i}: a step whose label runs to a whole sentence of words] --> S${i + 1}[Step ${i + 1}: a step whose label runs to a whole sentence of words]`).join('\n')}\n\`\`\`\n`;
    const small = async (md: string) => {
      const warn: string[] = [];
      await drawDiagrams(ingestMarkdown(md).doc, await loadTheme('plain'), browser, (m) => warn.push(m));
      return warn.find((w) => / D-SMALL:/.test(w)) ?? '';
    };
    expect(await small(steps('TD'))).toMatch(/too tall.*left-to-right direction/);
    const lr = await small(steps('LR'));
    expect(lr).toMatch(/D-SMALL/);
    expect(lr).not.toMatch(/left-to-right direction/);
  });
});

// docs/adr/0010: a flowchart's edges are right-angled. Every segment of
// every edge path in the gallery's flowchart and the three-gates chain (two
// decisions, branches and a loop) runs along x or along y.
describe('flowchart edges', () => {
  it('have no diagonal segment', async () => {
    const fc = /^## Flowchart\n+(```mermaid\n[\s\S]*?\n```)$/m.exec(GALLERY)![1]!;
    const gates = '```mermaid\nflowchart TD\n  A([New task]) --> B[Recall first]\n  B --> C{Bulk?}\n  C -->|yes| D[Ask]\n  C -->|no| E[Act in batches]\n  D --> E\n  E --> F{Read-back matches?}\n  F -->|no| G[Fix]\n  G -.-> E\n  F -->|yes| H[Report]\n```';
    const block = /^## Block\n+(```mermaid\n[\s\S]*?\n```)$/m.exec(GALLERY)![1]!;
    const doc = await drawDiagrams(ingestMarkdown(`${fc}\n\n${gates}\n\n${block}\n`).doc, await loadTheme('plain'), browser, () => {});
    const page = await browser.newPage();
    try {
      await page.setContent(`<div id="host">${doc.blocks.map((b) => (b.t === 'diagram' ? b.svg : '')).join('')}</div>`);
      // Read the path data itself: a curve command is a slant, and so is any
      // straight segment that moves along both axes.
      const slants = await page.evaluate(`[...document.querySelectorAll('#host path.flowchart-link')].flatMap((p) => {
        const d = p.getAttribute('d');
        if (/[CQSTAcqsta]/.test(d)) return [p.id + ' curves'];
        const pts = [...d.matchAll(/(-?[\\d.]+),(-?[\\d.]+)/g)].map((m) => [+m[1], +m[2]]);
        // A segment of no length at the end points the arrowhead nowhere:
        // it lies sideways (the review of 0c67f49).
        const last = pts.length > 1 && Math.hypot(pts.at(-1)[0] - pts.at(-2)[0], pts.at(-1)[1] - pts.at(-2)[1]) < 0.3 ? [p.id + ' ends on no length'] : [];
        return [...last, ...pts.slice(1).flatMap((q, i) => Math.abs(q[0] - pts[i][0]) > 0.3 && Math.abs(q[1] - pts[i][1]) > 0.3 ? [p.id + ' segment ' + i] : [])];
      })`) as string[];
      const edges = await page.evaluate(`document.querySelectorAll('#host path.flowchart-link').length`) as number;
      expect(edges).toBeGreaterThan(8);
      expect(slants).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

describe('budget selectors count what their key names', () => {
  it('counts classes without notes, and named states without forks and choices', async () => {
    const md = [
      '```mermaid\nclassDiagram\n  class Project\n  class Task\n  Project --> Task\n  note for Task "a note"\n  note "free note"\n```',
      '```mermaid\nstateDiagram-v2\n  [*] --> Draft\n  state fork1 <<fork>>\n  state ch <<choice>>\n  Draft --> fork1\n  fork1 --> Review\n  fork1 --> Check\n  Review --> ch\n  ch --> Done\n```',
    ].join('\n\n') + '\n';
    const doc = await drawDiagrams(ingestMarkdown(md).doc, await loadTheme('plain'), browser, () => {});
    const page = await browser.newPage();
    try {
      await page.setContent('<div id="host"></div>');
      const got: Record<string, number> = {};
      for (const b of doc.blocks) {
        if (b.t !== 'diagram') continue;
        const t = REGISTRY.find((d) => d.id === b.kind)!;
        await page.evaluate(`document.getElementById('host').innerHTML = ${JSON.stringify(b.svg)}`);
        const m = await page.evaluate(measureScript(Object.fromEntries(Object.entries(t.budget).map(([k, v]) => [k, v.count])))) as Measured;
        Object.assign(got, m.counts);
      }
      expect(got).toEqual({ classes: 2, states: 4 });
    } finally {
      await page.close();
    }
  });
});

describe(':::focus', () => {
  it('outlines every marked shape in the brand, and not the rows inside an entity', async () => {
    const theme = await loadTheme('tebin');
    const md = [
      '```mermaid\nflowchart TD\n  A[Box]:::focus --> B{Decide}:::focus\n  B --> C[(Store)]:::focus\n  C --> D([Stadium]):::focus\n  D --> E((Circle)):::focus\n  E --> F[Plain]\n```',
      '```mermaid\nerDiagram\n  PROJECT ||--o{ TASK : has\n  PROJECT:::focus {\n    string code\n    date start\n  }\n```',
    ].join('\n\n') + '\n';
    const doc = await drawDiagrams(ingestMarkdown(md).doc, theme, browser, () => {});
    const n = parseInt(diagramTokens(theme).brand.slice(1), 16);
    const brand = `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    const page = await browser.newPage();
    try {
      await page.setContent(`<div id="host">${doc.blocks.map((b) => (b.t === 'diagram' ? b.svg : '')).join('')}</div>`);
      const painted = await page.evaluate(`[...document.querySelectorAll('#host g.node')].map((g) => ({
        focus: g.classList.contains('focus'),
        outline: [...g.querySelectorAll('rect, polygon, circle, ellipse, path')].some((s) => getComputedStyle(s).stroke === ${JSON.stringify(brand)}),
        rows: [...g.querySelectorAll('[class*="row-rect"] *, [class*="row-rect"]')].filter((s) => getComputedStyle(s).stroke === ${JSON.stringify(brand)}).length,
      }))`) as { focus: boolean; outline: boolean; rows: number }[];
      expect(painted.filter((p) => p.focus).map((p) => p.outline)).toEqual([true, true, true, true, true, true]);
      expect(painted.filter((p) => !p.focus).map((p) => p.outline)).not.toContain(true);
      expect(painted.reduce((s, p) => s + p.rows, 0)).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('outlines the marked node in the brand, and only that one', async () => {
    const theme = await loadTheme('tebin');
    const doc = await drawDiagrams(ingestMarkdown('```mermaid\nflowchart TD\n  A[One]:::focus --> B[Two]\n```\n').doc, theme, browser, () => {});
    const svg = doc.blocks.find((b) => b.t === 'diagram')!;
    const page = await browser.newPage();
    try {
      await page.setContent(`<div id="host">${svg.t === 'diagram' ? svg.svg : ''}</div>`);
      const strokes = await page.evaluate(`[...document.querySelectorAll('#host g.node')].map((g) =>
        getComputedStyle(g.querySelector('rect, polygon, path')).stroke)`) as string[];
      const n = parseInt(diagramTokens(theme).brand.slice(1), 16);
      const brand = `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
      expect(strokes).toHaveLength(2);
      expect(strokes.filter((s) => s === brand)).toHaveLength(1);
    } finally {
      await page.close();
    }
  });
});

describe.each(['plain', 'tebin', 'haskoning'])('the gallery under %s', (themeId) => {
  it('raises no finding', async () => {
    const warn: string[] = [];
    await drawDiagrams(ingestMarkdown(GALLERY).doc, await loadTheme(themeId), browser, (m) => warn.push(m));
    expect(warn.filter((w) => / D-[A-Z]+:/.test(w))).toEqual([]);
  });
});

describe('every budget selector', () => {
  it('counts more than nothing on its gallery diagram', async () => {
    const doc = await drawDiagrams(ingestMarkdown(GALLERY).doc, await loadTheme('plain'), browser, () => {});
    const page = await browser.newPage();
    try {
      await page.setContent('<div id="host"></div>');
      const empty: string[] = [];
      for (const b of doc.blocks) {
        if (b.t !== 'diagram') continue;
        const t = REGISTRY.find((d) => d.id === b.kind)!;
        const sel = Object.fromEntries(Object.entries(t.budget).map(([k, v]) => [k, v.count]));
        await page.evaluate(`document.getElementById('host').innerHTML = ${JSON.stringify(b.svg)}`);
        const m = await page.evaluate(measureScript(sel)) as Measured;
        for (const k of Object.keys(sel)) if (!(m.counts[k]! > 0)) empty.push(`${t.id}.${k} (${sel[k]})`);
      }
      expect(empty).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
