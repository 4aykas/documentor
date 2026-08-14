// Shared by html.ts and docx.ts (and, for the "must be unaffected" guarantee,
// implicitly by md.ts, which never imports this at all — see md.ts's own
// comment on why a rule stays a rule there). Computed once so the two
// renderers that DO draw zones cannot silently compute the split two
// different ways — the same reason firstPageHeader is "a deliberate pair"
// between them.
//
// See ir/types.ts's "flat on purpose": this is a renderer-side read of a
// flat block list, not an IR container. The IR still has no concept of a
// panel or a foot — only `rule` blocks, exactly as before. Only a renderer
// that has decided to draw a cover page's zones (`meta.cover === true`) ever
// calls this; an ordinary document's `rule` never reaches it.

import type { Block } from '../ir/types.js';

/** Every index in `blocks` that holds a `rule`. */
export function ruleIndexes(blocks: Block[]): number[] {
  const idxs: number[] = [];
  blocks.forEach((b, i) => {
    if (b.t === 'rule') idxs.push(i);
  });
  return idxs;
}

export type CoverZones = { panel: Block[]; flowing: Block[]; foot: Block[] };

/**
 * Splits a cover page's leading blocks into panel / flowing / foot:
 * - 0 rules: everything is `flowing` (panel and foot both empty) — the
 *   caller must recognise this and fall back to its pre-existing unzoned
 *   rendering rather than draw an empty panel, per this feature's "a cover
 *   with no rules must render exactly as it does today" rule.
 * - 1 rule: `panel` is everything before it, `flowing` is everything after,
 *   `foot` stays empty — there is only one rule to mark an end, not a start
 *   and an end, so nothing is pinned to the bottom.
 * - >=2 rules: `panel` is before the first, `foot` is after the last,
 *   `flowing` is whatever sits between them.
 *
 * `ruleIdxs` is a parameter rather than recomputed here so a caller that
 * also needs the count (to pick which of the three shapes above applies)
 * cannot end up disagreeing with this function about what it is.
 */
export function partitionCoverBlocks(blocks: Block[], ruleIdxs: number[]): CoverZones {
  if (ruleIdxs.length === 0) return { panel: [], flowing: blocks, foot: [] };
  const first = ruleIdxs[0]!;
  const panel = blocks.slice(0, first);
  if (ruleIdxs.length === 1) return { panel, flowing: blocks.slice(first + 1), foot: [] };
  const last = ruleIdxs[ruleIdxs.length - 1]!;
  return { panel, flowing: blocks.slice(first + 1, last), foot: blocks.slice(last + 1) };
}

/**
 * A cover's own content is bounded by its own page break: `pageBlocks` is
 * what the zone split above may touch, `restBlocks` (the first `pagebreak`
 * onward, the marker itself included so the break still happens) is a
 * multi-page document's later sections, which must render completely
 * unaffected — a proposal's SCOPE OF SERVICE, SCHEDULE and the rest must not
 * become part of a layout trick meant for the one page before them.
 */
export function splitAtFirstPagebreak(blocks: Block[]): { pageBlocks: Block[]; restBlocks: Block[] } {
  const at = blocks.findIndex((b) => b.t === 'pagebreak');
  return at === -1 ? { pageBlocks: blocks, restBlocks: [] } : { pageBlocks: blocks.slice(0, at), restBlocks: blocks.slice(at) };
}
