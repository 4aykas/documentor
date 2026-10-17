// The drawings swapped in for their sources, each scaled to the page.

import type { Block, Doc } from '../../ir/types.js';
import type { Theme } from '../../theme/types.js';
import { findingLine } from './checks.js';
import { kindOf, leftToRight } from './mermaid/source.js';
import { typeByHead } from './registry.js';

type Code = Extract<Block, { t: 'code' }>;

/** One source as drawn, in the order the sources appear, or why it was not. */
export type Drawn = { svg: string; png: string; wPx: number; hPx: number; triedDown: boolean } | { error: string };

/** The drawings swapped in for their sources, each scaled to the page. */
export function place(doc: Doc, drawn: Drawn[], theme: Theme, colPt: number, maxHPt: number, onWarn: (m: string) => void,
  isSource: (b: Block) => b is Code & { lang: string }): Doc {
  let k = 0;
  const blocks = doc.blocks.map((b): Block => {
    if (!isSource(b)) return b;
    const d = drawn[k++]!;
    if ('error' in d) {
      onWarn(`diagram ${k} (${b.lang}) could not be drawn and is printed as its source instead: ${d.error}`);
      return b;
    }
    let wPt = d.wPx * 0.75;
    let hPt = d.hPx * 0.75;
    const fit = Math.min(1, colPt / wPt, maxHPt / hPt);
    wPt *= fit; hPt *= fit;
    // A chart Mermaid draws at a fixed size, whatever it holds, would
    // otherwise take the whole column: a pie of four slices half a page.
    // The cap never takes the labels below three quarters of the body size.
    const cap = typeByHead(kindOf(b.text))?.mermaid?.widthCap;
    if (cap !== undefined && wPt > colPt * cap) {
      const s = Math.max((colPt * cap) / wPt, Math.min(1, 0.75 / fit));
      wPt *= s; hPt *= s;
    }
    // Labels are laid out at the body size, so the scale the picture prints
    // at is the size they print at; far below it they are the smallest text
    // on the page.
    const scale = wPt / (d.wPx * 0.75);
    const type = typeByHead(kindOf(b.text));
    // The cap can set the scale to exactly 0.75, which floating point puts a
    // hair below; that is the limit, not past it.
    if (scale < 0.75 - 1e-9) {
      // The advice follows what binds. Too wide: top-down helps only a flow
      // not already tried that way, otherwise fewer boxes side by side. Too
      // tall (the three-gates chain, 2026-10-17): a chain that long reads
      // better split, or across the page — but only a top-down flowchart or
      // state diagram can still turn; one written left to right is tall
      // because it was already turned.
      const tall = maxHPt / (d.hPx * 0.75) < colPt / (d.wPx * 0.75);
      const canTurn = (type?.id === 'flowchart' || type?.id === 'state') && leftToRight(b.text) === null;
      const advice = tall
        ? (canTurn
          ? 'it is too tall for the page: splitting the chain in two or a left-to-right direction would keep them readable'
          : 'it is too tall for the page: splitting it in two would keep them readable')
        : leftToRight(b.text) !== null && !d.triedDown
          ? 'a top-down direction or fewer side-by-side boxes would keep them readable'
          : 'fewer side-by-side boxes or shorter labels would keep them readable';
      onWarn(findingLine(k, type?.id ?? (kindOf(b.text) || b.lang), { code: 'D-SMALL',
        message: `labels print at about ${(theme.type.bodyPt * scale).toFixed(1)}pt against ${theme.type.bodyPt}pt body text; ${advice}` }));
    }
    return { t: 'diagram', lang: 'mermaid', kind: type?.id ?? '', source: b.text, svg: d.svg, png: d.png, wPt: round(wPt), hPt: round(hPt) };
  });
  return { ...doc, blocks };
}

const round = (n: number) => Math.round(n * 100) / 100;
