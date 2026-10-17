import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { drawDiagrams } from '../../src/render/diagrams/index.js';
import { loadTheme } from '../../src/theme/resolve.js';

// The fences reviews broke the engines with (test/fixtures/diagram-hostile.md),
// each held to its heading: drawn with no finding, refused with the reason
// named, or drawn with exactly the findings it is known for. Under plain the
// heading is exact; under a dark theme with other faces the refusals hold
// and no geometric finding appears that plain does not have.

const FILE = readFileSync(fileURLToPath(new URL('../fixtures/diagram-hostile.md', import.meta.url)), 'utf8');
type Case = { head: string; fence: string };
const cases: Case[] = FILE.split(/^## /m).slice(1).map((s) => ({
  head: s.slice(0, s.indexOf('\n')).trim(),
  fence: /^(`{3,4})(?:chart|axonometric|mermaid)\n[\s\S]*?^\1$/m.exec(s)![0],
}));
const expect_ = (head: string) => {
  const kind = /^(drawn|refused|warned)/.exec(head)![1]!;
  const detail = head.slice(kind.length).replace(/^:\s*/, '').split(' — ')[0]!.trim();
  return { kind, detail, codes: kind === 'warned' ? detail.split(/,\s*/) : [] };
};

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

async function outcome(fence: string, themeId: string) {
  const warn: string[] = [];
  const doc = await drawDiagrams(ingestMarkdown(`${fence}\n`).doc, await loadTheme(themeId), browser, (m) => warn.push(m));
  return {
    drawn: doc.blocks.some((b) => b.t === 'diagram'),
    codes: [...new Set(warn.flatMap((w) => /\) (D-[A-Z]+):/.exec(w)?.[1] ?? []))].sort(),
    text: warn.join('\n'),
  };
}

describe('the hostile fences', () => {
  it('are many, and each says what it must do', () => {
    expect(cases.length).toBeGreaterThan(40);
    for (const c of cases) expect(c.head, c.head).toMatch(/^(drawn|refused: .+|warned: D-[A-Z]+(, D-[A-Z]+)*) — /);
  });

  it.each(cases.map((c) => [c.head, c] as const))('under plain: %s', async (_, c) => {
    const want = expect_(c.head);
    const got = await outcome(c.fence, 'plain');
    if (want.kind === 'refused') {
      expect(got.drawn).toBe(false);
      expect(got.text).toContain(want.detail);
    } else {
      expect(got.drawn, got.text).toBe(true);
      expect(got.codes, got.text).toEqual(want.codes);
    }
  });

  it.each(cases.map((c) => [c.head, c] as const))('under lionfocus: %s', async (_, c) => {
    const want = expect_(c.head);
    const got = await outcome(c.fence, 'lionfocus');
    if (want.kind === 'refused') {
      expect(got.drawn).toBe(false);
      expect(got.text).toContain(want.detail);
      return;
    }
    expect(got.drawn, got.text).toBe(true);
    // Another face may add a size finding; it may not add a geometric one,
    // and it may not lose a geometric one the case is known for.
    const geometric = (codes: string[]) => codes.filter((x) => ['D-CLIP', 'D-COLLIDE', 'D-COVER', 'D-CROSS'].includes(x));
    expect(geometric(got.codes).filter((x) => !want.codes.includes(x)), got.text).toEqual([]);
    expect(geometric(want.codes).filter((x) => !got.codes.includes(x)), got.text).toEqual([]);
  });
});
