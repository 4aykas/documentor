// IR + theme → one self-contained HTML document. Everything the page needs is
// in the string: no <link>, no remote image, no webfont URL. See fonts.ts for
// why that rule is absolute.

import type { Block, Doc, Inline } from '../ir/types.js';
import { PAGE_PT, toMm, type Theme } from '../theme/types.js';
import { partitionCoverBlocks, ruleIndexes, splitAtFirstPagebreak } from './cover-zones.js';
import { arimoFaceCss } from './fonts.js';
import { LETTERHEAD_ENTITY_DATE_GAP_PT, letterheadDocLines } from './letterhead.js';
import { refusedLinkTarget, schemeIsRefused } from './links.js';
import { SCALE_STEPS, stepOf, weekLabel } from './tint.js';

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

function block(b: Block): string {
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
      const head = b.head
        .map((c, i) => `<th style="text-align: ${ALIGN_CSS[b.align[i] ?? 'l']}">${inline(c)}</th>`)
        .join('');
      const rows = b.rows
        .map(
          (row) =>
            `<tr>${row
              .map((c, i) => `<td style="text-align: ${ALIGN_CSS[b.align[i] ?? 'l']}">${inline(c)}</td>`)
              .join('')}</tr>`,
        )
        .join('');
      return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
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
 * need, drawn either by firstPageHeader (plain) or inside the panel div
 * (zoned, see coverMain below). Kept as one function so the two paths cannot
 * quietly drift into two different-looking titles.
 */
function coverTitleMarkup(doc: Doc): string {
  return `<h1 class="doc-title doc-title--cover">${escapeHtml(doc.meta.title)}</h1>${
    doc.meta.subtitle ? `<p class="doc-subtitle">${escapeHtml(doc.meta.subtitle)}</p>` : ''
  }`;
}

/**
 * The brand's corner glyph, inline, sized to `heightPt` and painted through
 * the same `.logo`-style class rules the wordmark uses (see the CSS below) —
 * `cls` picks which positioning rule places it (page corner vs. panel
 * corner). Empty when the theme carries no mark, so a theme that names none
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
  const { pageBlocks, restBlocks } = splitAtFirstPagebreak(doc.blocks);
  const ruleIdxs = ruleIndexes(pageBlocks);

  if (ruleIdxs.length === 0) {
    // No rule at all: render exactly as this feature's predecessor did — see
    // this feature's "a cover with no rules must render exactly as it does
    // today" rule. No panel, no foot, no corner mark: nothing here is
    // guessed from an unmarked document.
    return `${coverTitleMarkup(doc)}${doc.blocks.map(block).join('\n')}`;
  }

  const { panel, flowing, foot } = partitionCoverBlocks(pageBlocks, ruleIdxs);
  const panelMark = cornerMarkMarkup(theme, 'corner-mark-panel', (theme.cornerMark?.heightPt ?? 0) * 0.6);
  const panelHtml = `<div class="cover-panel">${panelMark}${coverTitleMarkup(doc)}${panel.map(block).join('\n')}</div>`;
  const flowingHtml = flowing.map(block).join('\n');
  const pageMark = cornerMarkMarkup(theme, 'corner-mark-page', theme.cornerMark?.heightPt ?? 0);
  const top = `<div class="cover-top">${panelHtml}${flowingHtml}</div>`;
  // Only >=2 rules produce a foot (see partitionCoverBlocks); with exactly
  // one, `foot` is empty and there is nothing to pin to the bottom, so the
  // page-height flex frame — which exists only to push the foot down — is
  // skipped and `top` renders in plain flow instead.
  const body = foot.length > 0
    ? `<div class="cover-frame">${top}<div class="cover-foot">${foot.map(block).join('\n')}</div></div>`
    : top;
  return `${pageMark}${body}${restBlocks.map(block).join('\n')}`;
}

function firstPageHeader(doc: Doc, theme: Theme): string {
  // `meta.cover === true` suppresses the theme's chrome — logo, letterhead
  // lines, this document's own entity/date lines and the brand tick rule —
  // for a cover page that supplies its own layout as ordinary content
  // instead, and draws the title at the theme's cover size and colour
  // (`.doc-title--cover` below) instead of its ordinary heading ones. The
  // title and subtitle text itself is never suppressed: it is the document
  // speaking, not the theme's, so it prints either way. Absent (or false) is
  // an ordinary document — the letterhead and the ordinary title every
  // document drew before this flag existed.
  const cover = doc.meta.cover === true;
  const chrome = cover ? '' : (() => {
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
    return `<header class="sheet-head">${logo}<div class="letterhead">${lines}${docLines}</div></header>
<div class="tick-row"><span class="tick"></span><span class="hair"></span></div>
`;
  })();
  return cover
    ? `${chrome}${coverTitleMarkup(doc)}`
    : `${chrome}<h1 class="doc-title">${escapeHtml(doc.meta.title)}</h1>${
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
/* This @page rule only governs a browser's own print preview of the raw
   HTML — useful for eyeballing the document standalone. The PDF that
   render/pdf.ts actually produces gets its margins from the page.pdf()
   call's own margin option, which Chromium honours instead of this rule
   once preferCSSPageSize is false; the two are computed the same way on
   purpose, but this one is not what ships. */
@page{ size: ${page.size}; margin: ${toMm(page.marginPt)}; }
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
   Only meta.cover === true (see firstPageHeader) adds the modifier below,
   which is the one place ty.titlePt/--title are ever spent: a theme applies
   to every document, so a theme-wide 39pt/grey title would leak into a
   re-issued report or a memo that never asked for a cover page. */
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
table.heatmap{ table-layout: fixed; }
table.heatmap td, table.heatmap th{ border-bottom: none; text-align: center; padding: 3pt 2pt; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
/* table-layout: fixed sizes every column from the FIRST row's cells alone.
   That first row is the <thead> row, so the label column's width has to be
   set on its (empty) header cell, not on the <td class="hm-label"> below —
   a width there is simply ignored for layout purposes. */
table.heatmap thead th:first-child{ width: 28%; }
table.heatmap td.hm-label{ text-align: left; }
${SCALE_STEPS.map((t, i) => `.hm-s${i + 1}{ background: color-mix(in srgb, var(--brand) ${Math.round(t * 100)}%, white); }`).join('\n')}
.hm-marks{ color: var(--brand); letter-spacing: 1pt; } /* deliberate exemption from brandOnLight: a fill-shaped glyph, not small text; see heatmapBlocks() in docx.ts */
.pagebreak{ break-after: page; page-break-after: always; }
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
.cover-panel{ position: relative; border: 0.75pt solid var(--rule); padding: 20pt 24pt; }
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
/* The brand's corner glyph (see theme.cornerMark) at the page's physical
   top-right, offset past the print margin so part of it bleeds off the
   trimmed edge rather than merely touching it — the same look the three
   real originals this feature was built from carry. The extra offset is
   35% of the mark's own height, a taste call, not a measured brand value:
   the brand book prices the glyph's colour and shape, not how far off the
   page it hangs. */
.corner-mark-page{ position: absolute; top: -${(page.marginPt + (theme.cornerMark?.heightPt ?? 0) * 0.35).toFixed(2)}pt; right: -${(page.marginPt + (theme.cornerMark?.heightPt ?? 0) * 0.35).toFixed(2)}pt; }
/* The second placement: straddling the panel's own top-right corner. */
.corner-mark-panel{ position: absolute; top: 0; right: 0; transform: translate(35%, -35%); }
/* Same paint-by-class rule as .logo (see its own comment above), extended to
   the two corner-mark placements rather than duplicated for them. */
.corner-mark-page svg, .corner-mark-panel svg{ height: 100%; width: auto; display: block; }
.corner-mark-page .c-brand, .corner-mark-panel .c-brand{ fill: var(--brand); }
.corner-mark-page .c-muted, .corner-mark-panel .c-muted{ fill: var(--muted); }
.corner-mark-page .c-ink, .corner-mark-panel .c-ink{ fill: var(--ink); }`;

  const cover = doc.meta.cover === true;
  const headerHtml = cover ? '' : firstPageHeader(doc, theme);
  const mainHtml = cover ? coverMain(doc, theme) : doc.blocks.map(block).join('\n');

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
