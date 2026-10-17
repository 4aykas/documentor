import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { REGISTRY, drawDiagrams, leftToRight, typeByHead, typeOf } from '../../src/render/diagrams/index.js';
import { loadTheme } from '../../src/theme/resolve.js';

// The registry is the one list of what documentor draws (docs/adr/0005).
// This holds it consistent with itself and with the gallery, the fixture
// every theme is proofed and colour-checked against: a type in one and not
// the other is a type nobody looks at.

const GALLERY = readFileSync(fileURLToPath(new URL('../fixtures/diagram-gallery.md', import.meta.url)), 'utf8');

/** The gallery's sections: each `## ` heading and the first fence under it. */
function sections(md: string): { heading: string; fence: string }[] {
  return md.split(/^## /m).slice(1).map((s) => {
    const heading = s.slice(0, s.indexOf('\n')).trim();
    const fence = /^```mermaid\n([\s\S]*?)^```$/m.exec(s);
    if (fence === null) throw new Error(`gallery section "${heading}" has no mermaid fence`);
    return { heading, fence: fence[1]! };
  });
}

describe('the diagram registry', () => {
  it('names every type once: no shared id, label or header word', () => {
    const dup = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
    expect(dup(REGISTRY.map((d) => d.id))).toEqual([]);
    expect(dup(REGISTRY.map((d) => d.label))).toEqual([]);
    expect(dup(REGISTRY.flatMap((d) => [...d.heads]))).toEqual([]);
  });

  it('selects no type for a header word no record claims', () => {
    expect(typeByHead('notADiagram')).toBeUndefined();
    expect(typeOf('')).toBeUndefined();
  });

  it('says a type turns top-down exactly where leftToRight does', () => {
    for (const d of REGISTRY) {
      for (const h of d.heads) {
        expect(leftToRight(`${h} LR\n  a`) !== null, `${d.id} (${h})`).toBe(d.mermaid?.turnsDown === true);
      }
    }
  });

  it('gives each drawn diagram its type\'s id as kind, and "" to a type Mermaid draws but no record claims', async () => {
    const browser = await chromium.launch();
    try {
      // A type Mermaid accepts and the registry does not list, so the
      // unrecorded path is actually drawn rather than refused by Mermaid.
      const unrecorded = '```mermaid\npacket-beta\n  0-15: "Source port"\n  16-31: "Destination port"\n```\n';
      expect(typeOf('packet-beta')).toBeUndefined();
      const doc = await drawDiagrams(ingestMarkdown(GALLERY + unrecorded).doc, await loadTheme('plain'), browser, () => {});
      const kinds = doc.blocks.flatMap((b) => (b.t === 'diagram' ? [b.kind] : []));
      expect(kinds).toEqual([...REGISTRY.map((d) => d.id), '']);
    } finally {
      await browser.close();
    }
  });

  it('matches the gallery: one section per type, in order, each headed with its label', () => {
    const got = sections(GALLERY);
    expect(got.map((s) => s.heading)).toEqual(REGISTRY.map((d) => d.label));
    for (const s of got) expect(typeOf(s.fence)?.label, s.heading).toBe(s.heading);
  });
});
