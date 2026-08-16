// IR + theme → one self-contained HTML document. Everything the page needs is
// in the string: no <link>, no remote image, no webfont URL. See fonts.ts for
// why that rule is absolute.

import type { Block, Doc, Inline } from '../ir/types.js';
import { PAGE_PT, toMm, type Theme } from '../theme/types.js';
import { PANEL_BORDER_PT, coverStatementPt, partitionCoverBlocks, ruleIndexes, splitAtFirstPagebreak } from './cover-zones.js';
import { arimoFaceCss } from './fonts.js';
import { LETTERHEAD_ENTITY_DATE_GAP_PT, letterheadDocLines } from './letterhead.js';
import { refusedLinkTarget, schemeIsRefused } from './links.js';
import { SCALE_STEPS, STATEMENT_TINT, mixToWhite, readableOn, stepOf, weekLabel } from './tint.js';
import { columnWidthsDxa, dxa, fitsWidth, isKeyValue } from './table-width.js';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * What a refused link shows instead: the link's own text, then where it pointed,
 * in the muted style — the same shape as the image placeholder, for the same
 * reason. The rule about which schemes get here, and how the target is named,
 * lives in links.ts, because the Markdown renderer refuses the same set.
 *
 * The text keeps no class of its own. It is ordinary prose once the link is
 * gone, and the muted target beside it is already the whole visible signal that
 * a link was refused; a hook with no rule behind it is the promise that
 * `table.landscape` was, and it goes the same way.
 */
function refusedLinkMarkup(href: string, text: string): string {
  return `${text}<span class="link-refused-target">${escapeHtml(refusedLinkTarget(href))}</span>`;
}

function inline(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text': return escapeHtml(n.v);
        case 'strong': return `<strong>${inline(n.children)}</strong>`;
        case 'em': return `<em>${inline(n.children)}</em>`;
        case 'code': return `<code>${inline(n.children)}</code>`;
        case 'link':
          return schemeIsRefused(n.href)
            ? refusedLinkMarkup(n.href, inline(n.children))
            : `<a href="${escapeHtml(n.href)}">${inline(n.children)}</a>`;
      }
    })
    .join('');
}

const ALIGN_CSS = { l: 'left', r: 'right', c: 'center' } as const;

/**
 * Embedding a remote image would mean Chromium fetches it at print time —
 * a deliberate, opt-in network step that phase 1 does not have. Silently
 * reaching out to whatever host a document's markup happens to name breaks
 * both reproducibility (output now depends on a server staying up) and
 * trust (rendering someone else's document would make a request to a third
 * party on their behalf). Only a `data:` URI is already fully inline, so
 * only that renders as a real <img>; everything else becomes a visible
 * placeholder that a reader can immediately read as "not embedded".
 */
function imageMarkup(src: string, alt: string, widthPt?: number): string {
  if (src.startsWith('data:')) {
    return `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${
      widthPt ? ` style="width: ${widthPt}pt"` : ''
    }></figure>`;
  }
  let host = '';
  try {
    host = new URL(src).host;
  } catch {
    // Not a parseable URL — e.g. a relative path like "./chart.png". Falls
    // through to the placeholder with alt text only, rather than throwing.
  }
  return `<figure class="img-placeholder"><div class="img-placeholder-box">${escapeHtml(alt)}${
    host ? `<span class="img-placeholder-host">${escapeHtml(host)}</span>` : ''
  }</div></figure>`;
}

/** What a table needs to size its columns: the text column's full width and
 *  the theme's body size. Threaded through block() rather than read from a
 *  module-level theme so nothing here depends on render order. */
type ColSizing = { totalDxa: number; landscapeDxa: number; bodyPt: number };

/** The text column's width in DXA and the theme's body size — the two
 *  numbers table-width.ts needs, read off the theme in one place. */
function colSizing(theme: Theme): ColSizing {
  const page = PAGE_PT[theme.page.size];
  return {
    totalDxa: dxa(page.w - theme.page.marginPt * 2),
    // The same text column with the sheet turned on its side, which is
    // where a table too wide for the portrait one goes.
    landscapeDxa: dxa(page.h - theme.page.marginPt * 2),
    bodyPt: theme.type.bodyPt,
  };
}

function block(b: Block, size: ColSizing): string {
  switch (b.t) {
    case 'heading':
      return `<h${b.level}>${inline(b.text)}</h${b.level}>`;
    case 'para':
      return `<p>${inline(b.text)}</p>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const items = b.items.map((it) => `<li>${inline(it)}</li>`).join('');
      // A list is split into fragments wherever a sublist interrupts it, so an
      // ordered fragment after a sublist must resume its numbering rather than
      // restart at 1.
      const start = b.ordered && b.start !== undefined && b.start !== 1 ? ` start="${b.start}"` : '';
      return `<${tag} class="d${b.depth}"${start}>${items}</${tag}>`;
    }
    case 'table': {
      const cols = Math.max(b.head.length, ...b.rows.map((r) => r.length));
      // The same widths Word uses, from the same solver — see table-width.ts.
      // Emitted as a <colgroup> under `table-layout: fixed`, which is what
      // makes them binding: with the automatic algorithm a declared width is
      // a suggestion Chromium may overrule from cell content, and it did —
      // that is how the same table came out proportioned one way here and
      // another way in Word. Fixed layout also means a table can no longer
      // be wider than the page, which used to make Chromium silently scale
      // every page of the document down to fit it.
      // A table with more columns than the portrait text column can give a
      // readable minimum to is drawn on a landscape page of its own instead
      // of being crushed into one. See fitsWidth() for where that line is,
      // and the `@page landscape` rule below for how the page is asked for.
      const wide = !fitsWidth(cols, size.totalDxa, size.bodyPt);
      const total = wide ? size.landscapeDxa : size.totalDxa;
      const widths = columnWidthsDxa(b, cols, total, size.bodyPt);
      const group = widths
        .map((w) => `<col style="width: ${((w / total) * 100).toFixed(3)}%">`)
        .join('');
      // A head row with nothing in any cell is not a header, it is a blank
      // line with a rule under it. Templates write one to satisfy Markdown's
      // table syntax, which has no way to say "this table has no header" —
      // the cover's metadata block is exactly that, and it printed an empty
      // banded row above "Proposal No." for its whole life.
      const headed = !isKeyValue(b);
      const head = headed
        ? `<thead><tr>${b.head
            .map((c, i) => `<th style="text-align: ${ALIGN_CSS[b.align[i] ?? 'l']}">${inline(c)}</th>`)
            .join('')}</tr></thead>`
        : '';
      const rows = b.rows
        .map(
          (row) =>
            `<tr>${row
              .map((c, i) => `<td style="text-align: ${ALIGN_CSS[b.align[i] ?? 'l']}">${inline(c)}</td>`)
              .join('')}</tr>`,
        )
        .join('');
      // A table with no header is not a grid of data, it is a list of
      // labelled values — a cover's metadata block is the case that named
      // it. Markdown cannot express "no header", so the only way to get
      // one is to write an empty header row, which makes the intent
      // unambiguous. Banded rules under three short pairs, running the full
      // width of a page they use a third of, read as a table with empty
      // columns; without them the pairs read as what they are.
      const kind = headed ? 'sized' : 'sized keyvalue';
      const markup = `<table class="${kind}"><colgroup>${group}</colgroup>${head}<tbody>${rows}</tbody></table>`;
      return wide ? `<div class="wide-table">${markup}</div>` : markup;
    }
    case 'heatmap': {
      const weeks = b.rows[0]?.values.length ?? 0;
      const max = Math.max(0, ...b.rows.flatMap((r) => r.values));
      const td = (v: number): string => {
        // .hm-marks paints its glyph in the brand colour — a deliberate
        // exemption from "brandOnLight paints fills and large display type
        // only, never small text": a filled square glyph is a fill wearing a
        // text costume, not text, and the greyscale-printing promise this
        // style makes is unaffected (a red square prints as a grey square).
        if (b.style === 'marks') return `<td class="hm hm-marks">${'▪'.repeat(stepOf(v, max, 3))}</td>`;
        const cls = `hm hm-s${stepOf(v, max, SCALE_STEPS.length)}`;
        const text = b.style === 'numbers' && v > 0 ? String(v) : '';
        return `<td class="${cls}">${text}</td>`;
      };
      const head = `<tr><th></th>${Array.from({ length: weeks }, (_, i) => `<th>${weekLabel(i)}</th>`).join('')}</tr>`;
      const rows = b.rows
        .map((r) => `<tr><td class="hm-label">${escapeHtml(r.label)}</td>${r.values.map(td).join('')}</tr>`)
        .join('');
      return `<table class="heatmap"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
    }
    case 'image':
      return imageMarkup(b.src, b.alt, b.widthPt);
    case 'code':
      return `<pre><code>${escapeHtml(b.text)}</code></pre>`;
    case 'quote':
      return `<blockquote>${b.paras.map((p) => `<p>${inline(p)}</p>`).join('')}</blockquote>`;
    case 'rule':
      return '<hr>';
    case 'pagebreak':
      return '<div class="pagebreak"></div>';
  }
}

/**
 * The document title and subtitle at the theme's cover size/colour — the one
 * piece of markup a plain cover (no rules) and a zoned cover (>=1 rule) both
 * need, drawn either directly by coverMain (plain) or inside the panel div
 * it builds (zoned). Kept as one function so the two paths cannot quietly
 * drift into two different-looking titles.
 */
function coverTitleMarkup(doc: Doc): string {
  return `<h1 class="doc-title doc-title--cover">${escapeHtml(doc.meta.title)}</h1>${
    doc.meta.subtitle ? `<p class="doc-subtitle">${escapeHtml(doc.meta.subtitle)}</p>` : ''
  }`;
}

/**
 * The brand's corner glyph, inline, sized to `heightPt` and painted through
 * the same `.logo`-style class rules the wordmark uses (see the CSS below) —
 * `cls` picks which positioning rule places it. There is one such placement
 * left, the panel's corner: see coverMain on why the page-corner one is
 * refused here. Empty when the theme carries no mark, so a theme that names none
 * draws nothing rather than an invented approximation — see this feature's
 * "do not draw an approximation with CSS borders" rule.
 */
function cornerMarkMarkup(theme: Theme, cls: string, heightPt: number): string {
  if (!theme.cornerMark) return '';
  return `<div class="${cls}" style="height: ${heightPt}pt">${theme.cornerMark.svg}</div>`;
}

/**
 * The cover page's body when it has at least one `rule` to divide it into
 * zones — the panel (bordered, holds the title down through the leading
 * blocks), whatever flows between the first and last rule, and the foot
 * (only with >=2 rules, pinned to the bottom of the page via `.cover-frame`'s
 * flex layout). See this feature's own spec for the zone rule; the two
 * corner-mark placements are drawn here rather than in coverTitleMarkup
 * because one of them (the page corner) has nothing to do with the panel.
 *
 * Blocks from the first `pagebreak` onward render completely unaffected,
 * outside every zone wrapper — a cover's own content is bounded by its own
 * page break, and a multi-page proposal's later sections must not become a
 * flex child of a layout trick meant for one page. `restBlocks` therefore
 * includes the `pagebreak` block itself, so the break still happens exactly
 * where it always did.
 */
function coverMain(doc: Doc, theme: Theme): string {
  const size = colSizing(theme);
  const { pageBlocks, restBlocks } = splitAtFirstPagebreak(doc.blocks);
  const ruleIdxs = ruleIndexes(pageBlocks);

  if (ruleIdxs.length === 0) {
    // No rule at all: render exactly as this feature's predecessor did — see
    // this feature's "a cover with no rules must render exactly as it does
    // today" rule. No panel, no foot, no corner mark: nothing here is
    // guessed from an unmarked document.
    return `${coverTitleMarkup(doc)}${doc.blocks.map((x) => block(x, size)).join('\n')}`;
  }

  const { panel, flowing, foot } = partitionCoverBlocks(pageBlocks, ruleIdxs);
  // 0.6 of the mark's full height, smaller than the page-corner placement
  // below — another taste call, not a measured brand value: the panel is a
  // smaller frame than the page and a full-size mark would crowd it.
  const panelMark = cornerMarkMarkup(theme, 'corner-mark-panel', (theme.cornerMark?.heightPt ?? 0) * 0.6);
  const panelHtml = `<div class="cover-panel">${panelMark}${coverTitleMarkup(doc)}${panel.map((x) => block(x, size)).join('\n')}</div>`;
  // A `quote` between the rules is the cover's statement band (see the
  // `.cover-statement` CSS). The modifier is what turns the zone into a flex
  // column, and it is applied only when there is a band to centre: a cover
  // with no quote keeps plain block flow, and with it the margin collapsing
  // that flow implies, so nothing about such a page moves.
  const hasStatement = flowing.some((b) => b.t === 'quote');
  const mod = hasStatement ? ' cover-statement-zone' : '';
  const flowingHtml = `<div class="cover-flow${mod}">${flowing.map((x) => block(x, size)).join('\n')}</div>`;
  // No second, page-corner mark here. It was drawn for a while, offset past
  // the print margin so it would bleed off the trimmed edge the way the real
  // originals look — and it printed as nothing at all, every time. Chromium
  // clips a page's content to the content box; the print margin is where the
  // header template lives (see pdf.ts's runningHeader), and page content
  // cannot paint into it. There is no offset that makes this work: at the
  // margin's edge the glyph merely touches the text block, and past it the
  // glyph is gone. So the PDF draws the one mark it can draw honestly, on the
  // panel, and refuses the bleed rather than approximating it somewhere it
  // does not belong. Recorded in README.md's refusal register. Word is not
  // subject to this — an anchored picture there is positioned against the
  // page itself, so docx.ts keeps its page-corner mark (see cornerMarkImage).
  const top = `<div class="cover-top${mod}">${panelHtml}${flowingHtml}</div>`;
  // Only >=2 rules produce a foot (see partitionCoverBlocks); with exactly
  // one, `foot` is empty and there is nothing to pin to the bottom, so the
  // page-height flex frame — which exists only to push the foot down — is
  // skipped and `top` renders in plain flow instead.
  const body = foot.length > 0
    ? `<div class="cover-frame">${top}<div class="cover-foot">${foot.map((x) => block(x, size)).join('\n')}</div></div>`
    : top;
  return `${body}${restBlocks.map((x) => block(x, size)).join('\n')}`;
}

function firstPageHeader(doc: Doc, theme: Theme): string {
  // buildHtml only calls this for an ordinary document — a cover
  // (`meta.cover === true`) skips it entirely and draws its own layout via
  // coverMain instead, so what follows is unconditionally the theme's
  // chrome: logo, letterhead lines, this document's own entity/date lines,
  // the brand tick rule, and the ordinary heading-sized title.
  // The full letterhead, printed once in the body flow rather than in
  // Chromium's header box — the header box has no access to this stylesheet.
  const logo = theme.logo
    ? `<div class="logo" style="height: ${theme.logo.heightPt}pt">${theme.logo.svg}</div>`
    : '<div></div>';
  const lines = theme.letterhead
    .map((l, i) => `<div class="${i === 0 ? 'lh-name' : 'lh-line'}">${escapeHtml(l)}</div>`)
    .join('');
  // Which lines these are, in what order, and which get dropped: a decision
  // shared with docx.ts, see letterhead.ts. What's left here is only the
  // drawing — a <div> per line, marked on the first so the `.lh-doc-first`
  // rule below can open the gap above it.
  const docLines = letterheadDocLines(doc)
    .map((v, i) => `<div class="lh-doc${i === 0 ? ' lh-doc-first' : ''}">${escapeHtml(v)}</div>`)
    .join('');
  const chrome = `<header class="sheet-head">${logo}<div class="letterhead">${lines}${docLines}</div></header>
<div class="tick-row"><span class="tick"></span><span class="hair"></span></div>
`;
  return `${chrome}<h1 class="doc-title">${escapeHtml(doc.meta.title)}</h1>${
    doc.meta.subtitle ? `<p class="doc-subtitle">${escapeHtml(doc.meta.subtitle)}</p>` : ''
  }`;
}

export async function buildHtml(doc: Doc, theme: Theme): Promise<string> {
  const faces = await arimoFaceCss();
  const { colors: c, type: ty, page } = theme;
  const trim = PAGE_PT[page.size];
  const colWidthPt = trim.w - page.marginPt * 2;

  const css = `${faces}
:root{
  --brand: ${c.brandOnLight};
  --ink: ${c.ink};
  --muted: ${c.muted};
  --rule: ${c.rule};
  --title: ${c.title};
}
/* The sheet and its margins, and this IS what ships: pdf.ts prints with
   preferCSSPageSize, so Chromium takes them from here rather than from the
   page.pdf() options. It has to, because a named page is the only way one
   document can hold sheets of two orientations, and that is what the
   wide-table rule below needs. */
@page{ size: ${page.size}; margin: ${toMm(page.marginPt)}; }
/* A named page, asked for by the wide-table rule below. pdf.ts prints with
   preferCSSPageSize so that these two rules — not the print options —
   decide the sheet, which is the only way one document can hold pages of
   two orientations. */
@page landscape{ size: ${page.size} landscape; margin: ${toMm(page.marginPt)}; }
/* A table too wide for the portrait text column gets a sheet of its own,
   turned on its side (see where block() draws a table). The breaks either side
   are what keep the rotation to this one table instead of everything that
   follows it. */
.wide-table{ page: landscape; break-before: page; break-after: page; }
/* The portrait cap belongs to the portrait text column; on its own landscape
   sheet the table's percentages are already measured against the wider one,
   and leaving the cap on would strand a third of the page unused. */
.wide-table table.sized{ max-width: none; }
*{ box-sizing: border-box; }
html,body{ margin:0; padding:0; }
body{
  font-family: Arimo, ${theme.font.document}, sans-serif;
  font-size: ${ty.bodyPt}pt;
  line-height: ${ty.leading};
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}
/* The logo paints by class, never with an inline fill, so the theme owns its
   colour. A solid-black logo therefore means this stylesheet did not load. */
.logo svg{ height: 100%; width: auto; display: block; }
.logo .c-brand{ fill: var(--brand); }
.logo .c-muted{ fill: var(--muted); }
.logo .c-ink{ fill: var(--ink); }
.sheet-head{ display:flex; align-items:flex-start; justify-content:space-between; gap: 24pt; }
.letterhead{ text-align: right; color: var(--muted); }
.lh-name{ font-size: ${ty.smallPt + 0.5}pt; font-weight: 700; }
.lh-line{ font-size: ${ty.smallPt - 0.5}pt; }
.lh-doc{ font-size: ${ty.smallPt - 0.5}pt; }
.lh-doc-first{ margin-top: ${LETTERHEAD_ENTITY_DATE_GAP_PT}pt; }
.tick-row{ display:flex; align-items:center; gap: 6pt; margin: 14pt 0 0; }
.tick{ display:block; width: 28pt; height: 3pt; background: var(--brand); }
.hair{ display:block; flex:1; height: 0.75pt; background: var(--rule); }
/* An ordinary document's title is drawn exactly like any other heading —
   h1Pt, ink — regardless of what the theme's cover values are set to.
   Only meta.cover === true (see buildHtml, coverMain) adds the modifier
   below, which is the one place ty.titlePt/--title are ever spent: a theme
   applies to every document, so a theme-wide 39pt/grey title would leak into
   a re-issued report or a memo that never asked for a cover page. */
.doc-title{ font-size: ${ty.h1Pt}pt; font-weight: 700; margin: 22pt 0 0; letter-spacing: -0.01em; color: var(--ink); }
/* Colour is a theme value (colors.title in theme/types.ts), not a fixed
   choice here: it defaults to the theme's own ink, so a theme that says
   nothing about it renders the cover title in ordinary ink, like plain.
   TEBIN's generated theme sets it to grey — see theme/generate.ts — because
   all three real originals it was built from (Goehler, BER01, QTS) set
   their cover title in a lighter grey, not solid black. */
.doc-title--cover{ font-size: ${ty.titlePt}pt; color: var(--title); }
.doc-subtitle{ color: var(--muted); margin: 4pt 0 0; }
h1,h2,h3{ break-after: avoid; page-break-after: avoid; }
h2{ font-size: ${ty.h2Pt}pt; font-weight: 700; margin: 18pt 0 4pt; }
h3{ font-size: ${ty.h3Pt}pt; font-weight: 700; margin: 14pt 0 3pt; }
p{ margin: 0 0 ${(ty.bodyPt * 0.7).toFixed(1)}pt; orphans: 2; widows: 2; }
ul,ol{ margin: 0 0 ${(ty.bodyPt * 0.7).toFixed(1)}pt; padding-left: 16pt; }
${[0, 1, 2, 3].map((d) => `.d${d}{ margin-left: ${d * 14}pt; }`).join('\n')}
li{ margin: 0 0 2pt; }
blockquote{ margin: 0 0 10pt; padding-left: 12pt; border-left: 2pt solid var(--rule); color: var(--muted); }
pre{ background: #F6F6F4; padding: 8pt 10pt; border-radius: 2pt; overflow-wrap: anywhere; white-space: pre-wrap; break-inside: avoid; }
code{ font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: ${(ty.bodyPt * 0.92).toFixed(1)}pt; }
pre code{ font-size: ${(ty.bodyPt * 0.86).toFixed(1)}pt; }
/* break-after: avoid keeps a rule from being stranded alone at the foot of a
   page with the content it introduces pushed to the next one — the whole
   group moves together instead. */
hr{ border: 0; border-top: 0.75pt solid var(--rule); margin: 14pt 0; break-after: avoid; page-break-after: avoid; }
figure{ margin: 0 0 10pt; break-inside: avoid; }
.img-placeholder-box{ border: 0.75pt solid var(--rule); color: var(--muted); padding: 10pt 12pt; font-size: ${(ty.bodyPt * 0.95).toFixed(1)}pt; }
.img-placeholder-host{ display: block; margin-top: 3pt; font-size: ${(ty.bodyPt * 0.85).toFixed(1)}pt; }
img{ max-width: 100%; height: auto; }
table{ width: 100%; max-width: ${colWidthPt}pt; border-collapse: collapse; margin: 0 0 12pt; font-size: ${(ty.bodyPt * 0.95).toFixed(1)}pt; }
/* A row that splits across a page break loses its meaning; a whole table that
   cannot fit one page still has to break, so only the rows are protected. */
tr{ break-inside: avoid; }
thead{ display: table-header-group; }
th{ text-align: left; font-weight: 700; border-bottom: 1pt solid var(--rule); padding: 4pt 6pt; }
td{ border-bottom: 0.5pt solid var(--rule); padding: 4pt 6pt; vertical-align: top; }
/* The column widths block() emits in a <colgroup> are only binding under
   fixed layout: the automatic algorithm treats a declared width as one
   input among several and will overrule it from cell content. Fixed layout
   also means a table cannot be wider than the page — which is what used to
   make Chromium scale every page of the document down to fit one wide
   table, silently. See table-width.ts. */
table.sized{ table-layout: fixed; }
/* break-word, not anywhere: a word is broken only when it cannot fit a line
   of its own, rather than wherever the line happens to end. Plain anywhere
   feeds the min-content width, so it makes columns narrower than the text
   really needs and chops ordinary headers mid-syllable. */
table.sized td, table.sized th{ overflow-wrap: break-word; }
/* See the comment where block() picks this class. The label column is muted
   so the pair reads label-then-value rather than as two equal columns. */
table.keyvalue td{ border-bottom: 0; padding-top: 2pt; padding-bottom: 2pt; }
table.keyvalue td:first-child{ color: var(--muted); padding-left: 0; }
table.heatmap{ table-layout: fixed; }
table.heatmap td, table.heatmap th{ border-bottom: none; text-align: center; padding: 3pt 2pt; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
/* table-layout: fixed sizes every column from the FIRST row's cells alone.
   That first row is the <thead> row, so the label column's width has to be
   set on its (empty) header cell, not on the <td class="hm-label"> below —
   a width there is simply ignored for layout purposes. */
table.heatmap thead th:first-child{ width: 28%; }
table.heatmap td.hm-label{ text-align: left; }
/* Each step carries its own text colour, computed from the fill rather than
   inherited from the page. The darkest step is the brand at full strength,
   and a theme whose brand is dark — plain's IS its ink — drew the number
   black on black, so the value was not on the page at all. color-mix with
   these fractions and mixToWhite agree by construction (see tint.ts), so the
   colour named here is the colour the browser actually paints on. */
${SCALE_STEPS.map((t, i) => `.hm-s${i + 1}{ background: color-mix(in srgb, var(--brand) ${Math.round(t * 100)}%, white); color: ${readableOn(mixToWhite(theme.colors.brandOnLight, t), theme.colors.ink)}; }`).join('\n')}
.hm-marks{ color: var(--brand); letter-spacing: 1pt; } /* deliberate exemption from brandOnLight: a fill-shaped glyph, not small text; see heatmapBlocks() in docx.ts */
/* break-BEFORE, not after. With break-after, a marker that lands at the top
   of a fresh page (because the content before it filled the previous one)
   spends that whole page on nothing and the reader gets a blank sheet — seen
   between a proposal's last section and its annex. Break-before starts the
   page and lets what follows begin on it. */
.pagebreak{ break-before: page; page-break-before: always; }
a{ color: var(--ink); text-decoration: underline; text-decoration-color: var(--rule); }
.link-refused-target{ color: var(--muted); font-size: ${(ty.bodyPt * 0.85).toFixed(1)}pt; margin-left: 3pt; }
/* A cover with >=1 rule (see coverMain): body needs position:relative so the
   page-corner mark — position:absolute, offset negative — has something to
   anchor to besides the viewport. Harmless for every other document: nothing
   else on the page is absolutely positioned. */
body{ position: relative; }
/* The panel a cover's leading blocks sit inside (see coverMain/coverTitleMarkup).
   colors.rule is reused for the border rather than a new theme value —
   the same hairline colour already draws every rule and table edge on the
   page, and the panel is exactly that: a rule folded into a box. */
.cover-panel{ position: relative; border: ${PANEL_BORDER_PT}pt solid var(--rule); padding: 20pt 24pt; }
/* A cover's links are contact details, not navigation: an email address and a
   web address on a title page are there to be read off paper. The underline
   is web furniture that survives into print for no reader's benefit, so the
   cover drops it while every other page keeps it. The href is untouched —
   the link still works in a PDF reader, it just is not decorated. */
.cover-top a, .cover-foot a{ text-decoration: none; }
.cover-panel .doc-title--cover{ margin-top: 0; }
/* min-height, not height: a cover whose panel + flowing content already
   exceeds one page overflows into a second page exactly as any other
   overlong block would, rather than clipping — see coverMain's comment on
   why only the pre-pagebreak blocks ever reach this frame. With content
   shorter than one page, flex's space-between has somewhere to put the
   slack and the foot lands at the page's bottom edge; with content taller
   than the page, there is no slack to distribute and space-between
   degrades to ordinary top-to-bottom flow. */
.cover-frame{ display: flex; flex-direction: column; justify-content: space-between; min-height: ${(trim.h - page.marginPt * 2).toFixed(2)}pt; }
.cover-foot{ margin-top: 24pt; }
/* The statement band, and the flex column that positions it. Both are applied
   only to a cover whose flowing zone carries a quote (see coverMain), so a
   cover without one is untouched by every rule in this group.

   What it solves: the three real originals leave the middle of the cover
   empty, and a page that is a panel at the top, four lines under it and an
   address at the foot reads as unfinished rather than as composed. The band
   is the middle — but its text is the template's, verbatim, like every other
   sentence a proposal prints. This adds a place to put a sentence, not a
   sentence.

   An auto margin on both sides is the whole positioning trick: a flex item's auto margins
   absorb the free space of the column, half above and half below, which drops
   the band into the optical middle and pushes the lines after it (the
   author's contact block) down to sit just above the foot. Three groups, each
   where it belongs, with no fixed heights to go wrong when a project name
   runs to two lines. */
.cover-top.cover-statement-zone, .cover-flow.cover-statement-zone{ display: flex; flex-direction: column; flex: 1; }
/* Brand as a fill and brand as large display type: the two things
   colors.brandOnLight is allowed to paint. The fill is that same brand mixed
   toward white by STATEMENT_TINT — computed, not a second colour somebody has
   to declare — so a theme with any brand colour gets a readable band without
   the "no colour clears AA on both surfaces" problem colors.brandOnDark
   exists to refuse. */
.cover-statement-zone > blockquote{ margin: auto 0; padding: 18pt 22pt; color: var(--ink);
  background: color-mix(in srgb, var(--brand) ${Math.round(STATEMENT_TINT * 100)}%, white);
  border-left: 4pt solid var(--brand); }
.cover-statement-zone > blockquote > p{ margin-bottom: ${(ty.bodyPt * 0.5).toFixed(1)}pt; }
.cover-statement-zone > blockquote > p:first-child{ font-size: ${coverStatementPt(ty).toFixed(1)}pt;
  line-height: 1.15; font-weight: 700; color: var(--brand); }
.cover-statement-zone > blockquote > p:last-child{ margin-bottom: 0; }
/* Seated in the panel's top-right corner: the glyph's own top and right edges
   on the panel's own top and right borders, overlapping inwards. No overhang
   in either direction. Outwards is not available — a cover's panel spans the
   full content width, so its right border already sits on the boundary
   Chromium clips a page's content at, and a rightwards translate was cut off
   there (the printed glyph measured 9.0pt wide against the 14.2pt it should
   be, and the overflow shrank the whole page with it). Upwards is available
   but wrong: it leaves the mark floating above the frame instead of on it,
   which is not how the brand's own covers place it.

   The offset is the panel's border width, negated. An absolutely positioned
   child is placed against its ancestor's PADDING box, which is inside the
   border — so at top:0/right:0 the glyph sat just clear of the border and the
   hairline stayed visible running around its outside, which is exactly what a
   reader notices. Pulling it out by the border's own width puts the glyph's
   outer edges on the panel's outer edges, and the corner of the frame
   disappears under it. */
.corner-mark-panel{ position: absolute; top: -${PANEL_BORDER_PT}pt; right: -${PANEL_BORDER_PT}pt; }
/* Same paint-by-class rule as .logo (see its own comment above), extended to
   the two corner-mark placements rather than duplicated for them. */
.corner-mark-panel svg{ height: 100%; width: auto; display: block; }
.corner-mark-panel .c-brand{ fill: var(--brand); }
.corner-mark-panel .c-muted{ fill: var(--muted); }
.corner-mark-panel .c-ink{ fill: var(--ink); }`;

  const cover = doc.meta.cover === true;
  const headerHtml = cover ? '' : firstPageHeader(doc, theme);
  const size = colSizing(theme);
  const mainHtml = cover ? coverMain(doc, theme) : doc.blocks.map((x) => block(x, size)).join('\n');

  return `<!doctype html>
<html lang="${escapeHtml(doc.meta.lang)}">
<head><meta charset="utf-8"><title>${escapeHtml(doc.meta.title)}</title>
<style>${css}</style></head>
<body>
${headerHtml}
<main>
${mainHtml}
</main>
</body></html>`;
}
