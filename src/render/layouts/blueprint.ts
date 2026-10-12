// The page as a sheet of a drawing set. A4 turned landscape, a double frame
// with grid-reference zones (1–8 across, A–D down) and centring marks, and a
// title block in the bottom right that carries the document's own title,
// number and date and the sheet's place in the set. The cover is a cover
// sheet: the title, the document's sections drawn as a chain dimension with a
// numbered bubble per section, and the sections listed under it as a drawing
// list. Inside, each section opens on a detail bubble; tables are schedules,
// bullets are dimension ticks, numbered items sit in bubbles, a quote is a
// boxed note under a revision triangle, and gates stand on a dimension line.
// The frame and title block are drawn by Chromium's footer template on every
// sheet, so the body only has to keep clear of them.

import type { Ctx, CoverParts, Gates, Layout, Section } from './common.js';
import { gateLines } from './common.js';

/** Sheet geometry, mm, landscape. */
const W = 297, H = 210;
const OUT = 6, IN = 12;
const TB = { w: 140, h: 30 };
const M = { top: 19, side: 21, bottom: IN + TB.h + 5 };
const K = { hair: '#CDCDCE', faint: '#F3F3F3' };

/** Small labels in the title block, in the document's own language where one is known. */
const LABELS: Record<string, { title: string; doc: string; date: string; sheet: string }> = {
  en: { title: 'Title', doc: 'Document', date: 'Date', sheet: 'Sheet' },
  uk: { title: 'Назва', doc: 'Документ', date: 'Дата', sheet: 'Аркуш' },
  de: { title: 'Titel', doc: 'Dokument', date: 'Datum', sheet: 'Blatt' },
  pl: { title: 'Tytuł', doc: 'Dokument', date: 'Data', sheet: 'Arkusz' },
};
const labels = (lang: string) => LABELS[lang.slice(0, 2).toLowerCase()] ?? LABELS.en!;

/** The logo with its classes turned into fills, for places no stylesheet reaches. */
function paintedLogo(svg: string, c: Ctx['theme']['colors']): string {
  return svg.slice(svg.indexOf('<svg'))
    .replace(/class="c-brand"/g, `fill="${c.brandOnLight}"`)
    .replace(/class="c-muted"/g, `fill="${c.muted}"`)
    .replace(/class="c-ink"/g, `fill="${c.ink}"`)
    .replace('<svg ', '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet" ');
}

/** Frame, zones and centring marks for one sheet, in mm. */
function frame(ink: string): string {
  let s = `<rect x="${OUT}" y="${OUT}" width="${W - 2 * OUT}" height="${H - 2 * OUT}" fill="none" stroke="${ink}" stroke-width="0.25"/>`;
  s += `<rect x="${IN}" y="${IN}" width="${W - 2 * IN}" height="${H - 2 * IN}" fill="none" stroke="${ink}" stroke-width="0.6"/>`;
  const iw = W - 2 * IN, ih = H - 2 * IN;
  const t = (x: number, y: number, v: string) =>
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="2.5" text-anchor="middle" fill="${ink}" font-family="JetBrains Mono, monospace">${v}</text>`;
  for (let i = 0; i < 8; i++) {
    const x = IN + (iw / 8) * (i + 0.5);
    s += t(x, (OUT + IN) / 2 + 0.9, String(i + 1)) + t(x, H - (OUT + IN) / 2 + 0.9, String(i + 1));
    if (i) {
      const xx = IN + (iw / 8) * i;
      s += `<path d="M${xx.toFixed(1)} ${OUT} V${IN} M${xx.toFixed(1)} ${H - IN} V${H - OUT}" stroke="${ink}" stroke-width="0.25"/>`;
    }
  }
  'ABCD'.split('').forEach((L, j) => {
    const y = IN + (ih / 4) * (j + 0.5) + 0.9;
    s += t((OUT + IN) / 2, y, L) + t(W - (OUT + IN) / 2, y, L);
    if (j) {
      const yy = IN + (ih / 4) * j;
      s += `<path d="M${OUT} ${yy.toFixed(1)} H${IN} M${W - IN} ${yy.toFixed(1)} H${W - OUT}" stroke="${ink}" stroke-width="0.25"/>`;
    }
  });
  s += `<path d="M${W / 2} ${OUT} V${OUT - 3} M${W / 2} ${H - OUT} V${H - OUT + 3} M${OUT} ${H / 2} H${OUT - 3} M${W - OUT} ${H / 2} H${W - OUT + 3}" stroke="${ink}" stroke-width="0.35"/>`;
  return s;
}

/** A chain dimension, one numbered bubble per segment. Width in mm. */
function chain(n: number, w: number, c: Ctx['theme']['colors'], big: boolean): string {
  if (n === 0) return '';
  const h = big ? 18 : 13, y = big ? 13 : 9.5, r = big ? 3.6 : 2.8, seg = w / n;
  let s = `<svg viewBox="0 0 ${w} ${h}" style="width:${w}mm;height:${h}mm;display:block;overflow:visible">`;
  s += `<path d="M0 ${y} H${w}" stroke="${c.ink}" stroke-width="0.3"/>`;
  for (let i = 0; i <= n; i++) {
    const x = Math.min(w - 0.15, Math.max(0.15, i * seg));
    s += `<path d="M${x.toFixed(2)} ${y - 4} V${h}" stroke="${c.ink}" stroke-width="0.18"/>`;
    s += `<path d="M${(x - 1.1).toFixed(2)} ${y + 1.1} L${(x + 1.1).toFixed(2)} ${y - 1.1}" stroke="${c.ink}" stroke-width="0.55"/>`;
  }
  for (let i = 0; i < n; i++) {
    const cx = (i + 0.5) * seg;
    s += `<circle cx="${cx.toFixed(2)}" cy="${y - r - 1.4}" r="${r}" fill="#fff" stroke="${i === 0 ? c.brandOnLight : c.ink}" stroke-width="0.35"/>`;
    s += `<text x="${cx.toFixed(2)}" y="${(y - r - 1.4 + r * 0.36).toFixed(2)}" font-size="${(r * 0.95).toFixed(2)}" font-weight="700" text-anchor="middle" fill="${c.ink}" font-family="JetBrains Mono, monospace">${String(i + 1).padStart(2, '0')}</text>`;
  }
  return `${s}</svg>`;
}

/**
 * Chromium paints the footer template without waiting for a web font the
 * body has not used yet, so title-block text in such a face simply does not
 * appear. Setting the footer's faces and weights once in the body, unpainted,
 * has them loaded before the footer is drawn.
 */
const SAMPLE = '0123456789 / ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz ĄĆĘŁŃÓŚŹŻ ÄÖÜß АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ';
const PRELOAD = `<div aria-hidden="true" style="position:absolute;visibility:hidden;height:0;overflow:hidden;white-space:nowrap">${
  [["'JetBrains Mono'", 400], ["'JetBrains Mono'", 700], ['Arimo', 400], ['Arimo', 700]].map(([f, w]) => `<span style="font-family:${f};font-weight:${w}">${SAMPLE}</span>`).join('')}</div>`;

/** The section number a bubble and a drawing list show. */
const secNo = (s: string | null, i: number) => s ?? String(i + 1).padStart(2, '0');

export const blueprint: Layout = {
  footerOnFirstPage: true,

  css(ctx) {
    const c = ctx.theme.colors;
    return `
@page{ size: A4 landscape; margin: ${M.top}mm ${M.side}mm ${M.bottom}mm ${M.side}mm }
@page landscape{ size: A4 landscape; margin: ${M.top}mm ${M.side}mm ${M.bottom}mm ${M.side}mm }
body{ font-size: 8.8pt; line-height: 1.45; }
.bp-lab{ font-family: 'JetBrains Mono', monospace; font-size: 5.8pt; letter-spacing: .08em; text-transform: uppercase; color: ${c.muted} }
.bp-mono{ font-family: 'JetBrains Mono', monospace }
.bp-cover{ height: ${H - M.top - M.bottom - 1}mm; display: grid; grid-template-columns: 1.25fr 1fr; gap: 12mm; break-after: page; overflow: hidden }
.bp-cover-l{ display: flex; flex-direction: column }
.bp-title{ font-size: 38pt; font-weight: 700; line-height: 1.02; letter-spacing: -.02em; margin: 2mm 0 5mm }
.bp-line{ font-size: 10.5pt; line-height: 1.4; margin: 0 0 1mm }
.bp-line + .bp-line{ color: ${c.muted}; font-size: 9pt }
.bp-chain{ margin-top: auto }
.bp-box{ border: .25mm solid ${c.ink}; padding: 2.2mm 3mm; margin: 0 0 4mm; break-inside: avoid }
.bp-box > .bp-lab{ display: block; border-bottom: .25mm solid ${c.ink}; margin: -.4mm -.4mm 1.8mm; padding-bottom: 1.1mm; color: ${c.ink}; font-weight: 700 }
.bp-box p{ margin: 0 0 1mm }
.bp-list{ width: 100%; border-collapse: collapse; margin: 0; font-size: 8pt }
.bp-list td{ border: 0; border-bottom: .15mm solid ${K.hair}; padding: 1mm 1.2mm 1mm 0; vertical-align: top }
.bp-list td:first-child{ font-family: 'JetBrains Mono', monospace; font-weight: 700; width: 11mm; color: ${c.brandOnLight} }
.bp-list tr:last-child td{ border-bottom: 0 }
.bp-pairs{ display: grid; grid-template-columns: repeat(auto-fit, minmax(38mm, 1fr)); gap: 2mm 5mm }
.bp-statement p{ font-size: 9.6pt; line-height: 1.42; margin: 0 0 1.5mm }
.bp-mast{ display: grid; grid-template-columns: 1fr auto; gap: 10mm; align-items: end; border-bottom: .6mm solid ${c.ink}; padding-bottom: 3mm; margin-bottom: 7mm }
.bp-mast .bp-title{ font-size: 24pt; margin: 0 0 2mm }
.bp-mast .bp-pairs{ grid-template-columns: repeat(${Math.max(1, ctx.doc.meta.reference ? 2 : 1)}, auto) }
.bp-sec{ padding-left: 64mm; margin: 0 0 7mm; border-top: .25mm solid ${c.ink}; padding-top: 3mm; position: relative }
.bp-sec::after{ content: ''; display: block; clear: both }
.bp-sec.bp-untitled{ border-top: 0; padding-top: 0 }
.bp-head{ float: left; width: 56mm; margin-left: -64mm; display: grid; grid-template-columns: 12mm 1fr; gap: 3mm; align-items: start; break-after: avoid }
.bp-bub{ width: 12mm; height: 12mm; border: .35mm solid ${c.ink}; border-radius: 50%; position: relative; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 9pt; text-align: center; line-height: 6mm }
.bp-bub::after{ content: ''; position: absolute; left: 0; right: 0; top: 50%; border-top: .25mm solid ${c.ink} }
.bp-bub i{ display: block; height: 6mm; color: ${c.brandOnLight}; font-style: normal }
.bp-sec h1.bp-h{ font-size: ${ctx.theme.type.h1Pt}pt; line-height: 1.15; margin: .6mm 0 0; letter-spacing: -.01em }
h2{ font-family: 'JetBrains Mono', monospace; font-size: 7.4pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; line-height: 1.4; margin: 0; padding: 1.4mm 0 0; float: left; clear: left; width: 54mm; margin-left: -64mm; break-after: avoid }
.bp-sec h2 + *{ margin-top: 0 }
h2{ position: relative }
h2::before{ content: ''; position: absolute; left: 0; top: 0; width: ${W - 2 * M.side}mm; border-top: .25mm solid ${c.ink} }
.bp-sec h2:first-child::before, .bp-head + h2::before{ display: none }
.bp-sec > :not(h2) + h2 + *{ padding-top: 1.4mm }
h3{ font-size: 8.8pt; font-weight: 700; margin: 4mm 0 1.4mm }
p{ margin: 0 0 2.1mm }
table{ font-size: 7.8pt; line-height: 1.36; margin: 3mm 0 4mm; border-top: .6mm solid ${c.ink} }
th{ font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 6pt; letter-spacing: .06em; text-transform: uppercase; color: ${c.ink}; background: none; border-bottom: .3mm solid ${c.ink}; padding: 1.3mm 2mm 1.1mm 0 }
td{ border-bottom: .15mm solid ${K.hair}; padding: 1.2mm 2mm 1.2mm 0; vertical-align: top }
table.keyvalue{ border-top: 0 }
table.keyvalue td:first-child{ font-family: 'JetBrains Mono', monospace; font-size: 6.4pt; text-transform: uppercase; letter-spacing: .05em; width: 32% }
ul, ol{ list-style: none; padding: 0; margin: 1.6mm 0 3mm }
ul > li{ position: relative; padding: .5mm 0 .5mm 6mm }
ul > li::before{ content: ''; position: absolute; left: .8mm; top: 2.3mm; width: 2.6mm; height: .55mm; background: ${c.ink}; transform: rotate(-45deg) }
ul > li::after{ content: ''; position: absolute; left: 0; top: 2.55mm; width: 4.2mm; border-top: .18mm solid ${c.ink} }
ol{ counter-reset: k }
ol > li{ counter-increment: k; position: relative; padding: .8mm 0 .8mm 8mm; min-height: 6mm }
ol > li::before{ content: counter(k); position: absolute; left: 0; top: .5mm; width: 4.6mm; height: 4.6mm; border: .3mm solid ${c.brandOnLight}; border-radius: 50%; font: 700 6.6pt 'JetBrains Mono', monospace; display: flex; align-items: center; justify-content: center; color: ${c.ink} }
blockquote{ position: relative; border: .25mm solid ${c.ink}; background: none; margin: 4mm 0; padding: 2.4mm 3mm 2.4mm 11mm; font-size: 9pt; color: ${c.ink} }
blockquote::before{ content: ''; position: absolute; left: 3mm; top: 2.6mm; width: 0; height: 0; border-left: 2.6mm solid transparent; border-right: 2.6mm solid transparent; border-bottom: 4.4mm solid ${c.brandOnLight} }
blockquote::after{ content: ''; position: absolute; left: 3.85mm; top: 3.85mm; border-left: 1.75mm solid transparent; border-right: 1.75mm solid transparent; border-bottom: 2.9mm solid #fff }
blockquote p{ margin: 0 0 1.4mm }
hr{ border: 0; border-top: .25mm solid ${c.ink}; margin: 5mm 0; position: relative; overflow: visible }
pre, code{ font-family: 'JetBrains Mono', monospace }
pre{ border: .25mm solid ${c.ink}; padding: 2mm 3mm; background: none; font-size: 7.4pt }
.bp-gates{ margin: 5mm 0 6mm; break-inside: avoid }
.bp-gates svg{ display: block; width: 100%; height: auto; overflow: visible }
.bp-gate-cols{ display: grid; gap: 3mm; font-size: 7.6pt; line-height: 1.36; margin-top: 1.5mm }
.bp-gate-cols b{ display: block; margin: .4mm 0 .8mm }
.bp-end{ display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; margin: 8mm 0 0 64mm; break-inside: avoid }
.bp-end p{ margin: 0 0 1mm }
`;
  },

  cover(p, ctx) {
    const { kit } = ctx;
    const c = ctx.theme.colors;
    const n = ctx.sectionTitles.length;
    const list = ctx.sectionTitles.map((t, i) => `<tr><td>${String(i + 1).padStart(2, '0')}</td><td>${kit.esc(t)}</td></tr>`).join('');
    const pairs = p.pairs.map(([k, v]) => `<div><div class="bp-lab">${kit.inline(k)}</div><div>${kit.inline(v)}</div></div>`).join('');
    const note = (lines: CoverParts['contacts']) =>
      lines.length ? `<div class="bp-box">${lines.map((l) => `<p>${kit.inline(l)}</p>`).join('')}</div>` : '';
    return `${PRELOAD}<div class="bp-cover">
<div class="bp-cover-l">
  <div class="bp-title">${kit.esc(p.title)}</div>
  ${p.lines.map((l) => `<div class="bp-line">${kit.inline(l)}</div>`).join('')}
  ${p.statement.length ? `<blockquote class="bp-statement" style="margin-top:6mm">${p.statement.map((s) => `<p>${kit.inline(s)}</p>`).join('')}</blockquote>` : ''}
  <div class="bp-chain">${chain(n, 140, c, true)}</div>
</div>
<div>
  ${n ? `<div class="bp-box"><table class="bp-list">${list}</table></div>` : ''}
  ${pairs ? `<div class="bp-box"><div class="bp-pairs">${pairs}</div></div>` : ''}
  ${note(p.contacts)}${note(p.foot)}
</div>
</div>`;
  },

  masthead(p, ctx) {
    const { kit } = ctx;
    const n = ctx.sectionTitles.length;
    return `${PRELOAD}<div class="bp-mast"><div>
  <div class="bp-title">${kit.esc(p.title)}</div>
  ${p.lines.map((l) => `<div class="bp-line">${kit.inline(l)}</div>`).join('')}
</div>
<div>${n > 1 ? `<div style="margin-bottom:2mm">${chain(n, Math.min(110, n * 12), ctx.theme.colors, false)}</div>` : ''}
<div class="bp-pairs">${p.pairs.map(([k, v]) => `<div><div class="bp-lab">${kit.inline(k)}</div>${kit.inline(v)}</div>`).join('')}</div></div>
</div>`;
  },

  section(s: Section) {
    if (s.title === '' && s.num === null) return `<section class="bp-sec bp-untitled">${s.body}</section>`;
    const no = secNo(s.num, s.index);
    return `<section class="bp-sec"><div class="bp-head"><div class="bp-bub"><i>${no}</i></div><h1 class="bp-h">${s.title}</h1></div>${s.body}</section>`;
  },

  gates(g: Gates, ctx) {
    const c = ctx.theme.colors;
    const w = 190, n = g.rows.length;
    const months = g.rows.map((r) => r.month);
    const span = months.every((m) => m !== null) ? Math.max(1, ...(months as number[])) : null;
    const xs = g.rows.map((r, i) => 6 + (span === null ? i / Math.max(1, n - 1) : (r.month as number) / span) * (w - 12));
    let s = `<path d="M0 14 H${w}" stroke="${c.ink}" stroke-width="0.3"/>`;
    for (const x of [0, w]) s += `<path d="M${x} 9 V19" stroke="${c.ink}" stroke-width="0.2"/>`;
    xs.forEach((x, i) => {
      s += `<path d="M${x.toFixed(2)} 10 V19" stroke="${c.ink}" stroke-width="0.2"/><path d="M${(x - 1.1).toFixed(2)} 15.1 L${(x + 1.1).toFixed(2)} 12.9" stroke="${c.ink}" stroke-width="0.55"/>`;
      s += `<circle cx="${x.toFixed(2)}" cy="5.4" r="3.6" fill="#fff" stroke="${i === 0 ? c.brandOnLight : c.ink}" stroke-width="0.35"/>`;
      s += `<text x="${x.toFixed(2)}" y="6.7" font-size="3.3" font-weight="700" text-anchor="middle" fill="${c.ink}" font-family="JetBrains Mono, monospace">${g.rows[i]!.code}</text>`;
    });
    return `<div class="bp-gates"><div class="bp-lab">${g.head.join(' · ')}</div><svg viewBox="0 0 ${w} 20">${s}</svg>
<div class="bp-gate-cols" style="grid-template-columns:repeat(${n},1fr)">${g.rows.map((r) => {
      const l = gateLines(g, r);
      return `<div><div class="bp-lab">${l.date ?? ''}</div><b>${l.lead ?? ''}</b>${l.rest.join('<br>')}</div>`;
    }).join('')}</div></div>`;
  },

  end(p, ctx) {
    if (ctx.doc.meta.cover === true || (p.contacts.length === 0 && p.foot.length === 0)) return '';
    const { kit } = ctx;
    const box = (ls: CoverParts['contacts']) => (ls.length ? `<div class="bp-box">${ls.map((l) => `<p>${kit.inline(l)}</p>`).join('')}</div>` : '<div></div>');
    return `<div class="bp-end">${box(p.contacts)}${box(p.foot)}</div>`;
  },

  footer(ctx, faces) {
    const c = ctx.theme.colors;
    const { esc } = ctx.kit;
    const m = ctx.doc.meta;
    const L = labels(m.lang ?? 'en');
    const x0 = W - IN - TB.w, y0 = H - IN - TB.h;
    const logo = ctx.theme.logo ? paintedLogo(ctx.theme.logo.svg, c) : '';
    const entity = m.entity ?? ctx.theme.letterhead[0] ?? '';
    const cell = 'position:absolute;box-sizing:border-box;border-left:0.25mm solid ' + c.ink + ';border-top:0.25mm solid ' + c.ink + ';padding:1mm 1.6mm;overflow:hidden;';
    const lab = (s: string, col = c.muted) => `<div style="font-family:'JetBrains Mono',monospace;font-size:4.6pt;letter-spacing:.08em;text-transform:uppercase;color:${col};margin-bottom:.4mm">${esc(s)}</div>`;
    const cw = 34, rw = 27;
    return `<style>${faces}</style>
<div style="position:absolute;left:0;bottom:0;width:${W}mm;height:${H}mm;font-family:Arimo,Arial,sans-serif;color:${c.ink};-webkit-print-color-adjust:exact;print-color-adjust:exact">
<svg viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0;width:${W}mm;height:${H}mm">${frame(c.ink)}
<rect x="${x0}" y="${y0}" width="${TB.w}" height="${TB.h}" fill="#fff"/><path d="M${x0} ${y0} H${W - IN}" stroke="${c.ink}" stroke-width="0.6"/></svg>
<div style="${cell}left:${x0}mm;top:${y0}mm;width:${cw}mm;height:${TB.h}mm;border-top:0;display:flex;flex-direction:column;justify-content:center;gap:1.2mm">
  ${logo ? `<div style="height:9mm">${logo}</div>` : ''}${entity ? `<div style="font-size:5.4pt;line-height:1.25">${esc(entity)}</div>` : ''}</div>
<div style="${cell}left:${x0 + cw}mm;top:${y0}mm;width:${TB.w - cw}mm;height:17mm;border-top:0">${lab(L.title)}
  <div style="font-size:9pt;font-weight:700;line-height:1.2;max-height:7.6mm;overflow:hidden">${esc(m.title)}</div>
  ${m.subtitle ? `<div style="font-size:6.6pt;line-height:1.25;margin-top:.5mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.subtitle)}</div>` : ''}</div>
<div style="${cell}left:${x0 + cw}mm;top:${y0 + 17}mm;width:${TB.w - cw - 2 * rw}mm;height:13mm">${lab(L.doc)}<div style="font-size:7pt;font-family:'JetBrains Mono',monospace">${esc(m.reference ?? '')}</div></div>
<div style="${cell}left:${W - IN - 2 * rw}mm;top:${y0 + 17}mm;width:${rw}mm;height:13mm">${lab(L.date)}<div style="font-size:7pt">${esc(m.date ?? '')}</div></div>
<div style="${cell}left:${W - IN - rw}mm;top:${y0 + 17}mm;width:${rw}mm;height:13mm;background:${c.brandOnLight};color:#fff">${lab(L.sheet, '#fff')}
  <div style="font:700 11pt 'JetBrains Mono',monospace"><span class="pageNumber"></span><span style="font-size:7pt;font-weight:400"> / <span class="totalPages"></span></span></div></div>
</div>`;
  },
};
