// The language of haskoning.com, set by hand: cream page, a navy hero band
// with a white title and a hairline divider, colour sections (sky, mint),
// square outlined arrow buttons, tracked uppercase labels, rows that end in
// an arrow, a navy close under a teal strip. No logo and no photograph of
// theirs: the hero is a drawn bathymetric chart, coast and depth contours,
// in the house colours.

import type { Ctx, CoverParts, Gates, Layout, Section } from './common.js';
import { gateLines } from './common.js';

const H = { navy: '#002E4F', blue: '#206087', teal: '#009EAB', green: '#5CBD7D', mint: '#BDDECC', sky: '#BFE1E9', white: '#FFFFFF', cream: '#FAF2E3' };

function rng(seed: number) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

/** A coast with parallel depth contours; deterministic for a given seed. */
export function chart(w: number, h: number, seed: number, coast: number, id: string): string {
  const r = rng(seed);
  const ph = [r() * 6, r() * 6, r() * 6];
  const shore = (x: number, k = 0) => {
    const t = x / w;
    return h * (coast + 0.06 * Math.sin(t * 5.2 + ph[0]!) + 0.03 * Math.sin(t * 13 + ph[1]!) + 0.012 * Math.sin(t * 31 + ph[2]!))
      + k * (h * 0.05) * (1 + 0.28 * Math.sin(t * 3 + ph[1]!) + 0.012 * k * Math.sin(t * 7 + ph[2]!));
  };
  const path = (k: number) => { let d = ''; for (let x = -2; x <= w + 2; x += 1.5) d += `${d ? 'L' : 'M'}${x.toFixed(1)},${shore(x, k).toFixed(2)}`; return d; };
  let s = `<defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${H.teal}"/><stop offset=".35" stop-color="${H.blue}"/><stop offset="1" stop-color="${H.navy}"/></linearGradient>
<linearGradient id="${id}l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${H.green}"/><stop offset="1" stop-color="${H.mint}"/></linearGradient></defs>`;
  s += `<rect width="${w}" height="${h}" fill="url(#${id}s)"/><path d="${path(0)}L${w + 2},-2L-2,-2Z" fill="url(#${id}l)"/>`;
  for (let i = 1; i < 7; i++) s += `<path d="${path(-i * 0.9)}" fill="none" stroke="${H.white}" stroke-opacity=".28" stroke-width=".25"/>`;
  for (let k = 1; k < 16; k++) s += `<path d="${path(k)}" fill="none" stroke="${H.white}" stroke-opacity="${(0.55 - k * 0.028).toFixed(2)}" stroke-width="${k % 5 === 0 ? 0.5 : 0.22}"/>`;
  return s + `<path d="${path(0)}" fill="none" stroke="${H.cream}" stroke-width=".9"/>`;
}

const arrow = (col: string, size = 3.2) => `<svg viewBox="0 0 16 12" style="width:${size}mm;height:${size * 0.75}mm;display:inline-block;vertical-align:middle;flex:none"><path d="M0 6h13M8.5 1.2 13.4 6 8.5 10.8" fill="none" stroke="${col}" stroke-width="1.8"/></svg>`;
const sq = (left: boolean, col: string) => `<span class="h-sq" style="border-color:${col}">${left ? `<span style="display:inline-flex;transform:scaleX(-1)">${arrow(col, 3.6)}</span>` : arrow(col, 3.6)}</span>`;

export const haskoning: Layout = {
  css(ctx, cover) {
    return `
@page{ margin: 18mm 16mm 22mm 16mm }
${cover ? '@page :first{ margin: 0 }' : ''}
body{ font-size: 9.4pt; line-height: 1.5 }
.lay-svg{ position: absolute; display: block }
.abs{ position: absolute }
.h-over{ font-size: 7.6pt; font-weight: 700; text-transform: uppercase; letter-spacing: .045em }
.h-btn{ display: inline-flex; align-items: center; gap: 2.4mm; border: .35mm solid; padding: 2.2mm 4mm; font-weight: 700; font-size: 7.6pt; letter-spacing: .045em; text-transform: uppercase; line-height: 1 }
.h-sq{ display: inline-flex; align-items: center; justify-content: center; width: 9mm; height: 9mm; border: .35mm solid }
.h-cover{ position: relative; width: ${ctx.pageMm.w}mm; height: ${ctx.pageMm.h}mm; overflow: hidden; break-after: page }
.h-lead{ background: ${H.sky}; padding: 6mm 7mm; margin: 0 0 8mm; font-size: 10.4pt; line-height: 1.45 }
.h-lead p{ margin: 0 0 2mm } .h-lead p:last-child{ margin: 0 }
.h-sec{ margin: 0 0 8mm; -webkit-box-decoration-break: clone; box-decoration-break: clone }
.h-sec.tint-1{ background: ${H.sky}; padding: 8mm 8mm 5mm }
.h-sec.tint-2{ background: ${H.mint}; padding: 8mm 8mm 5mm }
.h-crumb{ font-size: 7.6pt; font-weight: 700 }
.h-crumb u{ text-decoration-thickness: .2mm; text-underline-offset: .8mm }
.h-title{ font-size: 23pt; line-height: 1.12; font-weight: 700; margin: 2.4mm 0 4mm; break-after: avoid }
h2{ font-size: 15pt; line-height: 1.2; font-weight: 700; margin: 6mm 0 2mm }
h3{ font-size: 7.6pt; font-weight: 700; text-transform: uppercase; letter-spacing: .045em; color: ${H.blue}; margin: 5mm 0 1.4mm }
p{ margin: 0 0 2.4mm }
blockquote{ background: ${H.navy}; color: ${H.white}; border: 0; padding: 5mm 6mm; margin: 4mm 0; font-size: 10pt; line-height: 1.5 }
blockquote p:last-child{ margin: 0 }
table{ font-size: 8.6pt; line-height: 1.38; margin: 4mm 0 }
th{ font-weight: 700; font-size: 7.4pt; letter-spacing: .045em; text-transform: uppercase; background: none; color: ${H.navy}; border-bottom: .5mm solid ${H.navy}; padding: 0 3mm 2mm 0 }
td{ border-bottom: .25mm solid rgba(0,46,79,.35); padding: 2.4mm 3mm 2.4mm 0 }
td:first-child{ font-weight: 700 }
table.keyvalue td:first-child{ font-weight: 500; color: ${H.blue} }
ul, ol{ list-style: none; padding: 0; margin: 2mm 0 4mm; border-top: .25mm solid rgba(0,46,79,.35) }
ul > li, ol > li{ position: relative; padding: 2.4mm 8mm 2.4mm 0; border-bottom: .25mm solid rgba(0,46,79,.35) }
ul > li::after, ol > li::after{ content: ''; position: absolute; right: .6mm; top: 50%; width: 2mm; height: 2mm; margin-top: -1mm; border-top: .45mm solid ${H.navy}; border-right: .45mm solid ${H.navy}; transform: rotate(45deg) }
ol{ counter-reset: k }
ol > li{ counter-increment: k; padding-left: 10mm }
ol > li::before{ content: counter(k, decimal-leading-zero); position: absolute; left: 0; font-weight: 700 }
hr{ border: 0; border-top: .25mm solid rgba(0,46,79,.35); margin: 6mm 0 }
.h-gates{ background: ${H.navy}; color: ${H.white}; padding: 7mm 6mm 6mm; margin: 5mm 0; display: grid; break-inside: avoid }
.h-gc{ padding: 0 3.4mm }
.h-gc + .h-gc{ border-left: .3mm solid rgba(255,255,255,.45) }
.h-gate-code{ display: flex; align-items: center; justify-content: space-between; font-size: 21pt; font-weight: 700; line-height: 1 }
.h-mast{ margin-bottom: 8mm; break-inside: avoid }
.h-end{ margin-top: 12mm; break-inside: avoid }
.h-end .strip{ background: ${H.teal}; color: ${H.white}; height: 9mm; display: flex; align-items: center; justify-content: center; font-size: 7.6pt; font-weight: 700 }
.h-end .box{ background: ${H.navy}; color: ${H.white}; padding: 9mm 8mm 8mm; display: grid; grid-template-columns: 1fr 1fr; gap: 9mm; font-size: 8pt }
.h-end .row{ display: flex; justify-content: space-between; align-items: center; gap: 4mm; padding: 2mm 0; border-bottom: .25mm solid rgba(255,255,255,.4) }
`;
  },

  cover(p, ctx) {
    const { kit } = ctx;
    const W = ctx.pageMm.w, Hh = ctx.pageMm.h;
    const big = p.lines.length ? p.lines[p.lines.length - 1]! : null;
    const strip = p.lines.slice(0, -1);
    const pill = p.pairs.length ? p.pairs[p.pairs.length - 1]![1] : null;
    const brand = ctx.doc.meta.entity ? kit.esc(ctx.doc.meta.entity) : '';
    const nav = ctx.sectionTitles.filter((t) => t.length <= 24).slice(0, 4);
    const firstSection = ctx.sectionTitles[0];
    const bandTop = 175;
    return `<div class="h-cover">
<div class="abs" style="left:0;top:0;width:${W}mm;height:9mm;display:flex;justify-content:flex-end;align-items:center;gap:7mm;padding:0 14mm;font-size:7.6pt">
  ${strip.map((l) => `<span>${kit.inline(l)}</span>`).join('')}${pill ? `<span style="background:${H.navy};color:${H.white};padding:1.4mm 3mm;font-size:7pt">${kit.inline(pill)}</span>` : ''}
</div>
<div class="abs" style="left:0;top:9mm;width:${W}mm;height:16mm;background:${H.white};display:flex;align-items:center;justify-content:space-between;padding:0 14mm;gap:8mm">
  <span style="font-weight:700;font-size:10pt;max-width:80mm;line-height:1.2">${brand}</span>
  <span style="display:flex;gap:7mm;font-weight:700;font-size:8.4pt">${nav.map((t) => `<span style="display:inline-flex;align-items:center;gap:1.6mm;white-space:nowrap">${kit.esc(t)} ${arrow(H.navy)}</span>`).join('')}</span>
</div>
<svg class="lay-svg" viewBox="0 0 ${W} 150" style="left:0;top:25mm;width:${W}mm;height:150mm">${chart(W, 150, 11, 0.3, 'cv')}</svg>
<div class="abs" style="left:0;top:${bandTop}mm;width:${W}mm;height:${Hh - bandTop}mm;background:${H.navy};color:${H.white}">
  <div class="abs" style="left:14mm;top:12mm;width:84mm">
    <div class="h-over" style="color:${H.sky}">${kit.esc(p.title)}</div>
    <div style="font-size:${big ? 26 : 30}pt;font-weight:700;line-height:1.1;margin-top:3mm">${big ? kit.inline(big) : kit.esc(p.title)}</div>
  </div>
  <div class="abs" style="left:105mm;top:12mm;width:.3mm;height:88mm;background:rgba(255,255,255,.55)"></div>
  <div class="abs" style="left:113mm;top:12mm;width:83mm;font-size:9.8pt;line-height:1.5">${p.statement[0] ? kit.inline(p.statement[0]) : ''}</div>
  <div class="abs" style="left:113mm;top:64mm;width:83mm;display:grid;grid-template-columns:repeat(${Math.max(1, Math.min(3, p.pairs.length))},1fr);gap:3mm;font-size:8pt">
    ${p.pairs.slice(0, 3).map(([k, v]) => `<div><div class="h-over" style="color:${H.sky};font-size:6.6pt">${kit.inline(k)}</div>${kit.inline(v)}</div>`).join('')}
  </div>
  ${p.pairs.slice(3).length ? `<div class="abs" style="left:113mm;top:76mm;width:83mm;font-size:7.6pt">${p.pairs.slice(3).map(([k, v]) => `${kit.inline(k)}: ${kit.inline(v)}`).join(' · ')}</div>` : ''}
  <div class="abs" style="left:113mm;top:84mm;display:flex;gap:3mm;align-items:center">${sq(true, H.white)}${sq(false, H.white)}${firstSection ? `<span style="width:3mm"></span><span class="h-btn" style="color:${H.navy};background:${H.white};border-color:${H.white}">${kit.esc(firstSection)} ${arrow(H.navy)}</span>` : ''}</div>
</div>
</div>
${p.statement.length > 1 ? `<div class="h-lead">${p.statement.slice(1).map((s) => `<p>${kit.inline(s)}</p>`).join('')}</div>` : ''}`;
  },

  masthead(p, ctx) {
    const { kit } = ctx;
    const w = ctx.pageMm.w - 32;
    return `<div class="h-mast">
<div style="position:relative;height:44mm"><svg class="lay-svg" viewBox="0 0 ${w} 44" style="inset:0;width:${w}mm;height:44mm">${chart(w, 44, 19, 0.36, 'mh')}</svg></div>
<div style="background:${H.navy};color:${H.white};padding:7mm 8mm 7mm;display:grid;grid-template-columns:1fr .3mm 70mm;gap:7mm">
  <div><div class="h-over" style="color:${H.sky}">${p.lines.map((l) => kit.inline(l)).join(' · ')}</div><div style="font-size:24pt;font-weight:700;line-height:1.1;margin-top:2mm">${kit.esc(p.title)}</div></div>
  <div style="background:rgba(255,255,255,.55)"></div>
  <div style="display:grid;gap:2mm;font-size:8pt;align-content:start">${p.pairs.map(([k, v]) => `<div><div class="h-over" style="color:${H.sky};font-size:6.6pt">${kit.inline(k)}</div>${kit.inline(v)}</div>`).join('')}</div>
</div></div>`;
  },

  section(s: Section, ctx) {
    if (s.title === '' && s.num === null) return `<section class="h-sec">${s.body}</section>`;
    const tint = s.index % 3 === 0 ? '' : ` tint-${s.index % 3}`;
    return `<section class="h-sec${tint}"><div class="h-crumb"><u>${ctx.kit.esc(ctx.doc.meta.title)}</u>${s.num ? ` &nbsp;›&nbsp; ${s.num}` : ''}</div><h1 class="h-title">${s.title}</h1>${s.body}</section>`;
  },

  gates(g: Gates) {
    const n = g.rows.length;
    return `<div class="h-gates" style="grid-template-columns:repeat(${n},1fr)"><div class="h-over" style="grid-column:1 / -1;color:${H.sky};font-size:6.6pt;padding:0 3.4mm 4mm;border:0">${g.head.join(' · ')}</div>${g.rows.map((r, i) => {
      const l = gateLines(g, r);
      return `<div class="h-gc"><div class="h-gate-code"><span>${r.code}</span>${i < n - 1 ? arrow(H.sky, 4) : ''}</div>
${l.date ? `<div class="h-over" style="color:${H.sky};font-size:6.8pt;margin-top:2.6mm">${l.date}</div>` : ''}
${l.lead ? `<div style="font-weight:700;font-size:9pt;line-height:1.25;margin-top:1mm">${l.lead}</div>` : ''}
<div style="font-size:7.8pt;line-height:1.38;margin-top:1.4mm">${l.rest.join('<br>')}</div></div>`;
    }).join('')}</div>`;
  },

  end(p, ctx) {
    if (p.contacts.length === 0 && p.foot.length === 0) return '';
    const { kit } = ctx;
    return `<div class="h-end"><div class="strip">${kit.esc(ctx.doc.meta.title)}${ctx.doc.meta.reference ? ` · ${kit.esc(ctx.doc.meta.reference)}` : ''}</div>
<div class="box"><div>${p.contacts.map((l, i) => `<div style="${i === 0 ? 'font-weight:700;font-size:11pt;line-height:1.25;margin-bottom:2mm' : 'opacity:.88'}">${kit.inline(l)}</div>`).join('')}</div>
<div>${p.foot.map((l) => `<div class="row"><span>${kit.inline(l)}</span>${arrow(H.white, 3.2)}</div>`).join('')}</div></div></div>`;
  },

  footer(ctx, faces) {
    const ref = ctx.doc.meta.reference ?? '';
    return `<style>${faces}</style><div style="width:100%;box-sizing:border-box;padding:0 60px 28px;display:flex;justify-content:space-between;font-family:Urbanist,Manrope,sans-serif;font-size:7pt;font-weight:700;color:${H.navy}">
<span>${ctx.kit.esc(ctx.doc.meta.title)}${ref ? ` · ${ctx.kit.esc(ref)}` : ''}</span><span class="pageNumber"></span></div>`;
  },
};

