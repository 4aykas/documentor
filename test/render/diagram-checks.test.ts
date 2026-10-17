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

describe(':::focus', () => {
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
