// The pipeline: template + data → Doc. Fields and boilerplate become one
// markdown source with a sentinel paragraph standing where each directive
// stood; the whole source goes through ingestMarkdown once (so the title is
// lifted and every markdown rule applies across the whole document, not per
// fragment); then each sentinel paragraph is replaced by its directive's
// computed blocks. Nothing here writes a sentence of its own — every word
// in the output came from the data file or the template, verbatim.
//
// The sentinel is spliced in bare, with none of its own padding — the
// template's own surrounding blank lines are what decide whether a directive
// becomes its own paragraph. That is deliberate, not an oversight: it is the
// same rule {{@directive}} must already obey inside the template (see
// template.ts's own-line check), and it is what lets a directive glued to a
// list item (no blank line above it) actually get swallowed into that list,
// which is the failure the "own paragraph" guard below exists to catch.

import { ingestMarkdown } from '../ingest/md.js';
import { sniffRaster } from '../ingest/docx.js';
import { ingestXlsx } from '../ingest/xlsx.js';
import type { Block, Doc } from '../ir/types.js';
import { budgetTable, budgetTotalCents, heatmapOf, scheduleTable, summaryTable } from './blocks.js';
import { formatMoney } from './money.js';
import { flattenTemplate, parseTemplate, type FlatItem } from './template.js';
import { ProposalError, type ProposalData } from './types.js';

/** A reference register is searched, not read; long is its nature. A sanity
 *  ceiling, not physics — and reachable from nowhere but this path. */
export const ANNEX_MAX_ROWS = 2000;

const SENTINEL = (i: number): string => `@@documentor-directive-${i}@@`;
const SENTINEL_RE = /^@@documentor-directive-(\d+)@@$/;

/** A client logo on the title page sits beside TEBIN's own letterhead mark,
 *  not in place of it — modest is the point. 110pt is close to what the
 *  originals themselves print at (roughly 85–105pt measured off
 *  orig-ber01-p1.png and orig-qts-p1.png), rounded to one number that reads
 *  as deliberate rather than measured-to-the-pixel from one sample offer. */
const CLIENT_LOGO_WIDTH_PT = 110;

export async function assembleProposal(
  args: { data: ProposalData; template: string; annex?: Buffer; clientLogo?: Buffer },
): Promise<{ doc: Doc; dropped: string[] }> {
  const { data } = args;
  const items = flattenTemplate(parseTemplate(args.template), data);
  const errors: string[] = [];
  const dropped: string[] = [];

  // The one cross-check the data cannot make alone: the summary line that
  // claims to cover the budget must equal the budget. A wrong figure in an
  // offer costs more than a failed build.
  const covering = data.summary?.find((s) => s.covers === 'budget');
  if (covering !== undefined) {
    const claimed = covering.priceCents;
    const computed = budgetTotalCents(data);
    if (claimed !== computed) {
      errors.push(
        `summary line "${covering.item}" says ${formatMoney(claimed, data.currency)} but the team's hours × rates come to ${formatMoney(computed, data.currency)} — one of the two is wrong, and this build will not choose which`,
      );
    }
  }

  // Expand every directive up front, collecting errors rather than stopping.
  const directives = items.filter((it): it is Extract<FlatItem, { t: 'directive' }> => it.t === 'directive');
  const expanded = new Map<number, Block[]>();
  for (const [i, d] of directives.entries()) {
    try {
      expanded.set(i, await expand(d));
    } catch (e) {
      if (e instanceof ProposalError) errors.push(...e.errors);
      else throw e;
    }
  }
  if (errors.length > 0) throw new ProposalError(errors);

  // One markdown source, sentinels standing where the directives stood — no
  // padding of our own added around them (see the module comment above).
  let di = 0;
  const mdSource = items.map((it) => (it.t === 'md' ? it.text : SENTINEL(di++))).join('');
  const ingested = ingestMarkdown(mdSource, { date: data.date });
  dropped.push(...ingested.dropped);

  // Splice: a sentinel is a paragraph whose sole content is its own marker.
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
    // A directive swallowed into a list item or a table cell never becomes
    // its own paragraph, so its blocks would silently vanish. Loud instead.
    const missing = directives.filter((_, i) => !spliced.has(i)).map((d) => `{{@${d.name}}}`);
    throw new ProposalError(missing.map((m) => `${m} did not stand alone as its own paragraph — put it on its own line with a blank line above and below`));
  }

  // The mirror of the `{{@annex}} with no bytes` error below, and it exists
  // because the asymmetry cost a real document: a data file named a
  // 267-row deliverables register, the template it was pointed at carried no
  // {{@annex}}, and the build succeeded — the workbook was read off disk,
  // parsed, and dropped without a word. Half an offer without its annex is
  // not an offer, in whichever direction the two disagree. A template that
  // genuinely does not want the annex says so by not naming one in the data.
  const placed = new Set(directives.map((d) => d.name));
  const unplaced = [
    ...(args.annex !== undefined && !placed.has('annex')
      ? ['an annex was supplied ("annex" in the data file) but this template never places it — add {{@annex}} to the template, or drop "annex" from the data']
      : []),
    ...(args.clientLogo !== undefined && !placed.has('clientlogo')
      ? ['a client logo was supplied ("clientLogo" in the data file) but this template never places it — add {{@clientlogo}} to the template, or drop "clientLogo" from the data']
      : []),
  ];
  if (unplaced.length > 0) throw new ProposalError(unplaced);

  const meta = {
    ...ingested.doc.meta,
    ...(data.cover === undefined ? {} : { cover: data.cover }),
  };
  return { doc: { meta, blocks }, dropped };

  async function expand(d: Extract<FlatItem, { t: 'directive' }>): Promise<Block[]> {
    switch (d.name) {
      case 'summary': return [summaryTable(data)];
      case 'budget': return [budgetTable(data)];
      case 'schedule': return [scheduleTable(data)];
      case 'heatmap': return [heatmapOf(data, d.args['style'])];
      case 'pagebreak': return [{ t: 'pagebreak' }];
      case 'annex': {
        if (args.annex === undefined) {
          throw new ProposalError(['{{@annex}} — no annex bytes were supplied; the data file must name one ("annex": "./deliverables.xlsx"), or the template must wrap the block in {{?annex}}…{{/?}}']);
        }
        let result;
        try {
          result = await ingestXlsx(args.annex, {}, { maxRows: ANNEX_MAX_ROWS });
        } catch (e) {
          // Every sheet in the workbook refused: ingestXlsx throws rather
          // than handing back a document with nothing in it. Half an offer
          // without its annex is not an offer, so this must fail the build
          // just as loudly as a partial refusal below does.
          throw new ProposalError([`annex: ${(e as Error).message}`]);
        }
        const refusals = result.dropped.filter((m) => /refused/.test(m));
        if (refusals.length > 0) {
          throw new ProposalError(refusals.map((m) => `annex: ${m}`));
        }
        dropped.push(...result.dropped.map((m) => `annex: ${m}`));
        return result.doc.blocks;
      }
      case 'clientlogo': {
        if (args.clientLogo === undefined) {
          throw new ProposalError(['{{@clientlogo}} — no client logo bytes were supplied; the data file must name one ("clientLogo": "./client-logo.png"), or the template must wrap the block in {{?clientLogo}}…{{/?}}']);
        }
        const mime = sniffRaster(args.clientLogo);
        if (mime === null) {
          throw new ProposalError(['clientLogo: not a raster format this build reads (PNG/JPEG/GIF/BMP)']);
        }
        const src = `data:${mime};base64,${args.clientLogo.toString('base64')}`;
        return [{ t: 'image', src, alt: "the client's logo", widthPt: CLIENT_LOGO_WIDTH_PT }];
      }
      default:
        throw new ProposalError([`unknown directive {{@${d.name}}} — this template language knows @summary, @budget, @schedule, @heatmap, @annex, @clientlogo, @pagebreak and {{section:name}}`]);
    }
  }
}
