// The reader is allowed to infer geometry; it is not allowed to be believed.
// A value that lands in the neighbouring column changes the row-major token
// sequence, and so does a dropped row, a merged pair of cells and a repeated
// header. Comparing the two sequences turns the inference into a claim the
// build can check. See docs/superpowers/specs/2026-08-16-pdf-ingest-design.md,
// "The token gate".

import type { Doc, Inline } from '../../ir/types.js';

const flatten = (nodes: Inline[]): string =>
  nodes.map((n) => (n.t === 'text' ? n.v : flatten(n.children))).join('');

/** Whitespace-separated tokens, after normalising the three things a PDF
 *  hides inside what looks like one visible word: a non-breaking space
 *  (U+00A0, common between a currency sign and its figure), a soft hyphen
 *  (U+00AD, a line-break artefact carrying no content of its own — dropped,
 *  not turned into a space, or "soft­hyphen" would tokenise as two words
 *  instead of the one the reader actually sees), and the "fi"/"fl" ligature
 *  glyphs some PDF fonts emit as a single character rather than two.
 *
 *  No explicit non-breaking-space handling appears below: JavaScript's `\s`
 *  already treats U+00A0 as whitespace (`/\s/.test(' ') === true`), so
 *  `.split(/\s+/)` normalises it for free. An earlier version of this
 *  function carried a `.replace(/ /g, ' ')` before the split — dead
 *  code a mutation test caught immediately (removing it changed no test's
 *  outcome, the signature of a line nothing depends on) — removed rather
 *  than kept for documentation's sake, since a comment saying "this
 *  matters" next to a line that provably doesn't is worse than no comment.
 *
 *  Order matters for what this gate catches (task-5 brief item 4) — this
 *  function only breaks a string into tokens, it never reorders them. */
export function tokenise(s: string): string[] {
  return s
    .replace(/­/g, '') // soft hyphen: a line-break artefact, not content
    .replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl') // ligature glyphs
    .split(/\s+/)
    .filter(Boolean);
}

/** The assembled IR, reduced to the same token sequence a human reading the
 *  page top-to-bottom would produce: block order as `blocks` already holds
 *  it (that order IS the reading order this reader committed to), a table's
 *  head row before its body rows, each row left-to-right. Every block type
 *  that can carry text is covered; a block type with none (`image`, `rule`,
 *  `pagebreak`, `heatmap`) contributes nothing, which is correct — there is
 *  no text on the source side for it to be checked against either. */
export function docTokens(doc: Doc): string[] {
  const out: string[] = [];
  for (const b of doc.blocks) {
    if (b.t === 'para' || b.t === 'heading') out.push(...tokenise(flatten(b.text)));
    else if (b.t === 'quote') for (const p of b.paras) out.push(...tokenise(flatten(p)));
    else if (b.t === 'list') for (const it of b.items) out.push(...tokenise(flatten(it)));
    else if (b.t === 'table') {
      for (const c of b.head) out.push(...tokenise(flatten(c)));
      for (const row of b.rows) for (const c of row) out.push(...tokenise(flatten(c)));
    } else if (b.t === 'code') out.push(...tokenise(b.text));
  }
  return out;
}

/** Compares two already-tokenised sequences and throws on the FIRST index
 *  where they diverge, naming both sides — never a diff of the whole
 *  document, which would bury the one token that matters under however many
 *  happen to differ afterwards once a sequence is merely shifted by one. A
 *  length mismatch is a divergence too: the shorter side reports
 *  "(nothing)" at the index the longer side still has a token for, which is
 *  what "a value the reader lost" and "a value the reader gained" both look
 *  like from here — the gate does not try to tell those apart, because
 *  guessing which one happened is exactly the kind of inference this gate
 *  exists to refuse to make. */
export function assertNoDivergence(source: string[], assembled: string[]): void {
  const n = Math.max(source.length, assembled.length);
  for (let i = 0; i < n; i++) {
    if (source[i] === assembled[i]) continue;
    throw new Error(
      `the reader's own output does not match the source\n` +
      `  token ${i + 1}: source says ${JSON.stringify(source[i] ?? '(nothing)')}, ` +
      `the assembled document says ${JSON.stringify(assembled[i] ?? '(nothing)')}`,
    );
  }
}
