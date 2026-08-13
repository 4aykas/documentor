// IR + theme → one self-contained HTML document. Everything the page needs is
// in the string: no <link>, no remote image, no webfont URL. See fonts.ts for
// why that rule is absolute.

import type { Block, Doc, Inline } from '../ir/types.js';
import { PAGE_PT, toMm, type Theme } from '../theme/types.js';
import { arimoFaceCss } from './fonts.js';
import { LETTERHEAD_ENTITY_DATE_GAP_PT, letterheadDocLines } from './letterhead.js';
import { refusedLinkTarget, schemeIsRefused } from './links.js';
import { HEATMAP_LEGEND, SCALE_STEPS, stepOf, weekLabel } from './tint.js';

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
        if (b.style === 'marks') return `<td class="hm hm-marks">${'▪'.repeat(stepOf(v, max, 3))}</td>`;
        if (b.style === 'fill') return v > 0 ? '<td class="hm hm-fill"></td>' : '<td class="hm hm-s0"></td>';
        const cls = `hm hm-s${stepOf(v, max, SCALE_STEPS.length)}`;
        const text = b.style === 'numbers' && v > 0 ? String(v) : '';
        return `<td class="${cls}">${text}</td>`;
      };
      const head = `<tr><th></th>${Array.from({ length: weeks }, (_, i) => `<th>${weekLabel(i)}</th>`).join('')}</tr>`;
      const rows = b.rows
        .map((r) => `<tr><td class="hm-label">${escapeHtml(r.label)}</td>${r.values.map(td).join('')}</tr>`)
        .join('');
      const legend = b.style === 'scale' ? `<p class="hm-legend">${escapeHtml(HEATMAP_LEGEND)}</p>` : '';
      return `<table class="heatmap"><thead>${head}</thead><tbody>${rows}</tbody></table>${legend}`;
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

function firstPageHeader(doc: Doc, theme: Theme): string {
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
<h1 class="doc-title">${escapeHtml(doc.meta.title)}</h1>${
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
.doc-title{ font-size: ${ty.h1Pt}pt; font-weight: 700; margin: 22pt 0 0; letter-spacing: -0.01em; }
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
table.heatmap td.hm-label{ text-align: left; width: 28%; }
${SCALE_STEPS.map((t, i) => `.hm-s${i + 1}{ background: color-mix(in srgb, var(--brand) ${Math.round(t * 100)}%, white); }`).join('\n')}
.hm-fill{ background: var(--brand); }
.hm-marks{ color: var(--brand); letter-spacing: 1pt; }
.hm-legend{ color: var(--muted); font-size: ${(ty.bodyPt * 0.85).toFixed(1)}pt; margin: 2pt 0 10pt; }
.pagebreak{ break-after: page; page-break-after: always; }
a{ color: var(--ink); text-decoration: underline; text-decoration-color: var(--rule); }
.link-refused-target{ color: var(--muted); font-size: ${(ty.bodyPt * 0.85).toFixed(1)}pt; margin-left: 3pt; }`;

  const body = doc.blocks.map(block).join('\n');

  return `<!doctype html>
<html lang="${escapeHtml(doc.meta.lang)}">
<head><meta charset="utf-8"><title>${escapeHtml(doc.meta.title)}</title>
<style>${css}</style></head>
<body>
${firstPageHeader(doc, theme)}
<main>
${body}
</main>
</body></html>`;
}
