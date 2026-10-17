import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Code that runs in the browser page is written as a template literal and
// handed to page.evaluate. In a template literal `\d` is just `d`: a regex
// written as /-flowchart-(.+)-\d+$/ there reaches the page as /-flowchart-(.+)-d+$/
// and matches nothing, silently. That happened three times in one day
// (node ids, repeated path points, path data). Page code needs `\\d`.
// This finds every template literal that is page code and fails on a single
// `\d \s \w \b \D \S \W \.` in it.

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const PAGE = /\b(document\.|querySelector|getComputedStyle|getBBox|getComputedTextLength|getPointAtLength|globalThis\.mermaid)/;
const SINGLE = /(?<!\\)\\[dswbDSWB.]/;

/** The template literals of a source, ${…} holes left out. */
export function templates(src: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let i = 0;
  const lineAt = (k: number) => src.slice(0, k).split('\n').length;
  const skipString = (q: string) => { i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; };
  const readTemplate = () => {
    const start = i;
    let text = '';
    i++;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { text += src[i]! + (src[i + 1] ?? ''); i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; skipCode('}'); text += '${}'; continue; }
      text += src[i++];
    }
    i++;
    out.push({ text, line: lineAt(start) });
  };
  const skipCode = (until: string | null) => {
    let depth = 0;
    while (i < src.length) {
      const c = src[i]!;
      if (until && c === until && depth === 0) { i++; return; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
      if (c === "'" || c === '"') { skipString(c); continue; }
      if (c === '`') { readTemplate(); continue; }
      i++;
    }
  };
  skipCode(null);
  return out;
}

const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
});

describe('page code in template literals', () => {
  it('finds the escape that bit (and not its doubled form)', () => {
    const bad = templates('const s = `(() => { const m = /x-\\d+$/.exec(document.title); })()`;')[0]!;
    const good = templates('const s = `(() => { const m = /x-\\\\d+$/.exec(document.title); })()`;')[0]!;
    expect(PAGE.test(bad.text) && SINGLE.test(bad.text)).toBe(true);
    expect(PAGE.test(good.text) && SINGLE.test(good.text)).toBe(false);
  });

  it('keeps every \\d, \\s, \\w, \\b and \\. doubled', () => {
    const offenders = files(SRC).flatMap((f) => templates(readFileSync(f, 'utf8'))
      .filter((t) => PAGE.test(t.text) && SINGLE.test(t.text))
      .map((t) => `${relative(SRC, f)}:${t.line}: ${SINGLE.exec(t.text)![0]}`));
    expect(offenders).toEqual([]);
  });
});
