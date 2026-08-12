import { expect } from 'vitest';
import type { Theme } from '../../src/theme/types.js';
import type { Block, Doc, Inline } from '../../src/ir/types.js';
import { schemeIsRefused } from '../../src/render/links.js';

// Content lifted out of one renderer's output, in reading order. `kind` is
// only used to route it into the right comparison.
export type Run = { kind: 'heading1' | 'heading2' | 'heading3' | 'listItem' | 'cell' | 'text'; text: string };

export const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Markdown markup → the words a reader sees. Order matters: links first. */
export function unmark(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\\\|/g, '|');
}

/** What the Markdown renderer put on the page. */
export function runsFromMarkdown(md: string): Run[] {
  const runs: Run[] = [];
  const lines = md.split('\n');
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) runs.push({ kind: 'text', text: norm(unmark(para.join(' '))) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = line.match(/^(`{3,})/);
    if (fence) {
      flushPara();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith(fence[1]!); i++) code.push(lines[i]!);
      // Code is never unmarked: its backticks and asterisks are its content.
      runs.push({ kind: 'text', text: norm(code.join(' ')) });
      continue;
    }
    if (line.trim() === '') { flushPara(); continue; }
    const heading = line.match(/^(#{1,3}) (.*)$/);
    if (heading) {
      flushPara();
      runs.push({ kind: `heading${heading[1]!.length}` as Run['kind'], text: norm(unmark(heading[2]!)) });
      continue;
    }
    const ordered = line.match(/^\s*(\d+)\. (.*)$/);
    if (ordered) {
      flushPara();
      // The marker is part of the run: it is what a reader compares when
      // they check that item 4 is not numbered 1 again.
      runs.push({ kind: 'listItem', text: `${ordered[1]}. ${norm(unmark(ordered[2]!))}` });
      continue;
    }
    const bullet = line.match(/^\s*- (.*)$/);
    if (bullet) {
      flushPara();
      // A bullet glyph is drawn, not typed, so the PDF has no text for it.
      runs.push({ kind: 'listItem', text: norm(unmark(bullet[1]!)) });
      continue;
    }
    if (line.startsWith('>')) {
      flushPara();
      const quoted = norm(unmark(line.replace(/^>\s?/, '')));
      if (quoted !== '') runs.push({ kind: 'text', text: quoted });
      continue;
    }
    if (line.startsWith('|')) {
      flushPara();
      const cells = line.slice(1, line.replace(/\s+$/, '').length - 1).split(/(?<!\\)\|/);
      // The alignment row is syntax, not content.
      if (cells.every((c) => /^\s*:?-+:?\s*$/.test(c))) continue;
      for (const c of cells) runs.push({ kind: 'cell', text: norm(unmark(c)) });
      continue;
    }
    // A horizontal rule, an image and the pagebreak comment all draw
    // something a reader sees but say nothing a reader reads.
    if (/^-{3,}$/.test(line.trim()) || line.startsWith('![') || line.startsWith('<!--')) {
      flushPara();
      continue;
    }
    para.push(line);
  }
  flushPara();
  return runs.filter((r) => r.text !== '');
}

/**
 * What the PDF renderer put on the page. An untagged PDF has no block types,
 * so the classification is by type size — which is exactly the evidence a
 * reader uses. It is coupled to the stylesheet's sizes on purpose: if a
 * renderer stops setting headings larger than body text, that is the bug.
 */
export function classify(sizePt: number, theme: Theme): Run['kind'] | 'chrome' {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.3;
  if (near(sizePt, theme.type.smallPt - 1)) return 'chrome'; // the running header
  if (near(sizePt, theme.type.h1Pt)) return 'heading1';
  if (near(sizePt, theme.type.h2Pt)) return 'heading2';
  if (near(sizePt, theme.type.h3Pt)) return 'heading3';
  if (near(sizePt, theme.type.bodyPt * 0.95)) return 'cell';
  return 'text';
}

/**
 * A sequence comparison that says what went wrong. `toEqual` on two long
 * arrays prints both and leaves the reader to diff them by eye, which is
 * exactly the moment a failing test stops being read.
 */
export function expectSameSequence(what: string, fromMd: string[], fromPdf: string[]): void {
  for (let i = 0; i < Math.max(fromMd.length, fromPdf.length); i++) {
    if (fromMd[i] === fromPdf[i]) continue;
    const detail =
      fromPdf[i] === undefined
        ? `the PDF renderer is missing ${what} #${i + 1}: ${JSON.stringify(fromMd[i])}`
        : fromMd[i] === undefined
          ? `the Markdown renderer is missing ${what} #${i + 1}: ${JSON.stringify(fromPdf[i])}`
          : `${what} #${i + 1} differs — Markdown: ${JSON.stringify(fromMd[i])} · PDF: ${JSON.stringify(fromPdf[i])}`;
    expect.fail(`the renderers disagree: ${detail}`);
  }
}

// Reading Word back. These are deliberately regexes over the part rather than
// an XML parse: what is being checked is a handful of specific elements, and a
// parser would add a dependency and a second thing to be wrong about. Note
// that <w:t> is always emitted as <w:t xml:space="preserve">, so a pattern
// matching a bare <w:t> finds nothing.

const TEXT = /<w:t[^>]*>([^<]*)<\/w:t>/g;

const textOf = (xml: string): string =>
  [...xml.matchAll(TEXT)].map((m) => m[1] ?? '').join('');

/** Every <w:p> in the part, with its style id if it has one. */
function paragraphs(xml: string): { style: string; xml: string }[] {
  return [...xml.matchAll(/<w:p(?: [^>]*)?>([\s\S]*?)<\/w:p>/g)].map((m) => ({
    style: m[1]?.match(/<w:pStyle w:val="([^"]+)"\/>/)?.[1] ?? '',
    xml: m[1] ?? '',
  }));
}

export function headingsFromDocx(xml: string): string[] {
  return paragraphs(xml)
    .filter((p) => /^DocH[123]$/.test(p.style))
    .map((p) => `h${p.style.slice(-1)} ${norm(textOf(p.xml))}`);
}

/**
 * The text of the paragraph carrying the `DocTitle` style, if any. Kept
 * separate from `headingsFromDocx` because the title is deliberately not a
 * heading — see the comment where this is used.
 */
export function docTitleFromDocx(xml: string): string | undefined {
  const p = paragraphs(xml).find((p) => p.style === 'DocTitle');
  return p === undefined ? undefined : norm(textOf(p.xml));
}

export function cellsFromDocx(xml: string): string[] {
  return [...xml.matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map((m) => norm(textOf(m[1] ?? '')));
}

function runsWith(xml: string, mark: string): string[] {
  return [...xml.matchAll(/<w:r>([\s\S]*?)<\/w:r>/g)]
    .filter((m) => (m[1] ?? '').includes(mark))
    .map((m) => norm(textOf(m[1] ?? '')))
    .filter((t) => t !== '');
}

export const boldRunsFromDocx = (xml: string): string[] => runsWith(xml, '<w:b/>');
export const italicRunsFromDocx = (xml: string): string[] => runsWith(xml, '<w:i/>');

export function linkTargetsFromRels(rels: string): string[] {
  return [...rels.matchAll(/Target="([^"]+)" TargetMode="External"/g)].map((m) => m[1]!);
}

// The IR side of the two comparisons above. Flattening an inline tree to its
// text is the same operation every renderer performs, so it belongs here once.

export function flattenInline(nodes: Inline[]): string {
  return norm(nodes.map((n) => (n.t === 'text' ? n.v : flattenInline(n.children))).join(''));
}

export function emphasisFromIr(doc: Doc, kind: 'strong' | 'em'): string[] {
  const out: string[] = [];
  const walk = (nodes: Inline[]): void => {
    for (const n of nodes) {
      if (n.t === 'text') continue;
      if (n.t === kind) out.push(flattenInline(n.children));
      walk(n.children);
    }
  };
  for (const b of doc.blocks) walk(inlinesOf(b));
  return out;
}

export function linkTargetsFromIr(doc: Doc): string[] {
  const out: string[] = [];
  const walk = (nodes: Inline[]): void => {
    for (const n of nodes) {
      if (n.t === 'text') continue;
      if (n.t === 'link' && !schemeIsRefused(n.href)) out.push(n.href);
      walk(n.children);
    }
  };
  for (const b of doc.blocks) walk(inlinesOf(b));
  return out;
}

/** Every inline sequence a block carries, in reading order. */
function inlinesOf(b: Block): Inline[] {
  switch (b.t) {
    case 'heading': case 'para': return b.text;
    case 'list': return b.items.flat();
    case 'table': return [...b.head.flat(), ...b.rows.flat().flat()];
    case 'quote': return b.paras.flat();
    case 'code': case 'rule': case 'pagebreak': case 'image': return [];
  }
}
