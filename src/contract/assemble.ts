// template + data → Doc, for a bilingual contract.
//
// The same shape as the proposal assembler, and deliberately so: fields and
// boilerplate become one markdown source with a sentinel paragraph standing
// where each directive stood, the whole source goes through ingestMarkdown
// once, then each sentinel is replaced by its directive's computed blocks.
// Nothing here writes a sentence of its own — every word in the output came
// from the data file or the template, verbatim, and a missing piece is an
// error naming it rather than invented text.
//
// That promise matters more here than anywhere else in this project. A
// proposal with a wrong figure costs money; a contract with an invented
// clause is a clause nobody agreed to.

import { ingestMarkdown } from '../ingest/md.js';
import type { Block, Doc } from '../ir/types.js';
import { flattenTemplate, parseTemplate, type FlatItem } from '../proposal/template.js';
import { ProposalError } from '../proposal/types.js';
import { articleBlocks, partiesBlock, signaturesBlock } from './blocks.js';
import { ContractError, type ContractData } from './types.js';

const SENTINEL = (i: number): string => `@@documentor-directive-${i}@@`;
const SENTINEL_RE = /^@@documentor-directive-(\d+)@@$/;

export function assembleContract(
  args: { data: ContractData; template: string },
): { doc: Doc; dropped: string[] } {
  const { data } = args;
  // The template language throws ProposalError (it is shared, not copied);
  // its messages are about templates, not proposals, so they are re-wrapped
  // rather than leaked under a name that would puzzle a contract author.
  let items: FlatItem[];
  try {
    items = flattenTemplate(parseTemplate(args.template), data);
  } catch (e) {
    if (e instanceof ProposalError) throw new ContractError(e.errors);
    throw e;
  }

  const dropped: string[] = [];
  const errors: string[] = [];

  const directives = items.filter((it): it is Extract<FlatItem, { t: 'directive' }> => it.t === 'directive');
  const expanded = new Map<number, Block[]>();
  for (const [i, d] of directives.entries()) {
    try {
      expanded.set(i, expand(d));
    } catch (e) {
      if (e instanceof ContractError) errors.push(...e.errors);
      else throw e;
    }
  }
  if (errors.length > 0) throw new ContractError(errors);

  let di = 0;
  const mdSource = items.map((it) => (it.t === 'md' ? it.text : SENTINEL(di++))).join('');
  const ingested = ingestMarkdown(mdSource, { date: data.date });
  dropped.push(...ingested.dropped);

  const blocks: Block[] = [];
  const spliced = new Set<number>();
  for (const b of ingested.doc.blocks) {
    const marker =
      b.t === 'para' && b.text.length === 1 && b.text[0]!.t === 'text'
        ? SENTINEL_RE.exec(b.text[0]!.v)
        : null;
    if (marker === null) {
      blocks.push(b);
      continue;
    }
    const idx = Number(marker[1]);
    blocks.push(...(expanded.get(idx) ?? []));
    spliced.add(idx);
  }
  if (spliced.size !== directives.length) {
    const missing = directives.filter((_, i) => !spliced.has(i)).map((d) => `{{@${d.name}}}`);
    throw new ContractError(missing.map((m) => `${m} did not stand alone as its own paragraph — put it on its own line with a blank line above and below`));
  }

  // The mirror of the proposal assembler's "unplaced annex" check, for the
  // same reason: a template that never places the articles would build a
  // contract consisting of its own preamble and nothing that was agreed, and
  // would do it silently.
  const placed = new Set(directives.map((d) => d.name));
  if (!placed.has('articles')) {
    throw new ContractError(['this template never places {{@articles}} — the contract would be printed without a single one of its own clauses']);
  }

  return { doc: { meta: ingested.doc.meta, blocks }, dropped };

  function expand(d: Extract<FlatItem, { t: 'directive' }>): Block[] {
    switch (d.name) {
      case 'parties': return [partiesBlock(data)];
      case 'articles': return articleBlocks(data);
      case 'signatures': return [signaturesBlock(data)];
      case 'pagebreak': return [{ t: 'pagebreak' }];
      default:
        throw new ContractError([`unknown directive {{@${d.name}}} — a contract template knows @parties, @articles, @signatures, @pagebreak and {{section:name}}`]);
    }
  }
}
