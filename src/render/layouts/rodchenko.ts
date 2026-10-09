// The constructivist poster-book, after Rodchenko: red, black and newsprint;
// the diagonal band; the circle; rays from a megaphone, after "Books!";
// heavy condensed capitals built like girders; gates that climb.

import type { Ctx, CoverParts, Gates, Layout, Section } from './common.js';
import { bigNumber, gateLines, plain } from './common.js';

const D = (deg: number) => (deg * Math.PI) / 180;
const cap = (s: string) => s.toUpperCase();

function rays(p: CoverParts, ctx: Ctx, ox: number, oy: number): string {
  const c = ctx.theme.colors;
  const spec = [
    { a0: 2, a1: 9.5, len: 205, fill: c.brandOnLight, d: 62, fs: 9.6 },
    { a0: 12, a1: 17, len: 200, fill: c.ink, d: 70, fs: 7.6 },
    { a0: 19.5, a1: 23.2, len: 185, fill: c.brandOnLight, d: 82, fs: 4.6 },
  ];
  const pt = (a: number, l: number) => `${(ox + Math.cos(D(a)) * l).toFixed(2)},${(oy - Math.sin(D(a)) * l).toFixed(2)}`;
  let s = '';
  spec.forEach((r, i) => {
    s += `<polygon points="${ox},${oy} ${pt(r.a0, r.len)} ${pt(r.a1, r.len)}" fill="${r.fill}"/>`;
    const line = p.lines[i];
    if (!line) return;
    const txt = ctx.kit.esc(plain(line));
    const a = (r.a0 + r.a1) / 2, avail = r.len - r.d - 8, natural = txt.length * r.fs * 0.56;
    const fit = natural > avail ? ` textLength="${avail.toFixed(1)}" lengthAdjust="spacingAndGlyphs"` : '';
    s += `<text transform="translate(${(ox + Math.cos(D(a)) * r.d).toFixed(2)} ${(oy - Math.sin(D(a)) * r.d).toFixed(2)}) rotate(${-a})" font-size="${r.fs}" font-weight="900" fill="${c.paper}" style="text-transform:uppercase" dominant-baseline="middle"${fit}>${txt}</text>`;
  });
  return s + `<circle cx="${ox}" cy="${oy}" r="9" fill="${c.ink}"/>`;
}

export const rodchenko: Layout = {
  css(ctx, cover) {
    const c = ctx.theme.colors;
    return `
@page{ margin: 20mm 18mm 22mm 18mm }
${cover ? '@page :first{ margin: 0 }' : ''}
body{ font-size: 9.4pt; line-height: 1.38 }
.lay-svg{ position: absolute; inset: 0; width: 100%; height: 100% }
.abs{ position: absolute }
.k-cap{ text-transform: uppercase; letter-spacing: .04em; font-weight: 700 }
.k-cover{ position: relative; width: ${ctx.pageMm.w}mm; height: ${ctx.pageMm.h}mm; overflow: hidden; break-after: page }
.k-statement{ background: ${c.ink}; color: ${c.paper}; font-weight: 700; font-size: 13.2pt; line-height: 1.22; padding: 6mm 24mm 6mm 6mm; clip-path: polygon(0 0, 100% 0, calc(100% - 14mm) 100%, 0 100%); margin: 0 0 6mm }
.k-statement-more{ font-weight: 700; margin: 0 0 2mm }
.k-sec{ margin: 0 0 10mm; border-top: 3mm solid ${c.ink}; padding-top: 4mm }
.k-sec.untitled{ border-top: 0; padding-top: 0 }
.k-head{ display: flex; align-items: flex-start; gap: 6mm; margin-bottom: 5mm; break-after: avoid; position: relative }
.k-num{ font-weight: 900; font-size: 54pt; line-height: .8; color: ${c.brandOnLight}; letter-spacing: -.01em }
.k-title{ font-weight: 900; font-size: 26pt; line-height: .92; text-transform: uppercase; margin: 0; flex: 1; padding-top: 1mm }
.k-wedge{ width: 22mm; height: 16mm; flex: none }
h2{ font-weight: 900; font-size: 15pt; line-height: 1; text-transform: uppercase; margin: 6mm 0 2.4mm }
h3{ font-weight: 700; font-size: 9.6pt; text-transform: uppercase; letter-spacing: .04em; color: ${c.brandOnLight}; margin: 4mm 0 1.6mm }
p{ margin: 0 0 2mm }
strong{ font-weight: 700 }
blockquote{ background: ${c.ink}; color: ${c.paper}; border: 0; padding: 4mm 5mm; margin: 4mm 0; font-weight: 700; font-size: 10pt; line-height: 1.3 }
blockquote p:last-child{ margin: 0 }
table{ font-size: 8.8pt; margin: 4mm 0 }
th{ text-transform: uppercase; letter-spacing: .04em; font-weight: 700; font-size: 7.2pt; color: ${c.brandOnLight}; background: none; border-bottom: 1.6mm solid ${c.ink}; padding: 0 3mm 2mm 0 }
td{ border-bottom: .4mm solid ${c.ink}; padding: 2.4mm 3mm 2.4mm 0 }
td:first-child{ font-weight: 900; text-transform: uppercase }
table.keyvalue td:first-child{ font-weight: 700; color: ${c.muted} }
ul, ol{ list-style: none; padding: 0; margin: 2mm 0 3mm }
ul > li{ position: relative; padding: .8mm 0 .8mm 8mm }
ul > li::before{ content: ''; position: absolute; left: 0; top: 1.9mm; border-left: 4.2mm solid ${c.ink}; border-top: 1.8mm solid transparent; border-bottom: 1.8mm solid transparent }
ol{ counter-reset: k }
ol > li{ counter-increment: k; position: relative; padding: 1.4mm 0 1.4mm 11mm; min-height: 10mm }
ol > li::before{ content: counter(k); position: absolute; left: 0; top: .6mm; width: 8mm; height: 8mm; border-radius: 50%; background: ${c.brandOnLight}; color: ${c.paper}; font-weight: 900; font-size: 11pt; display: flex; align-items: center; justify-content: center }
hr{ border: 0; height: 3mm; background: ${c.ink}; margin: 6mm 0 }
.k-gates{ position: relative; height: 112mm; margin: 6mm 0; break-inside: avoid }
.k-gates svg{ position: absolute; inset: 0; width: 100%; height: 100% }
.k-gl{ position: absolute; font-size: 7.6pt; line-height: 1.22 }
.k-gl b{ display: block; font-weight: 900; text-transform: uppercase; font-size: 9.4pt; line-height: 1.02; margin: .4mm 0 .8mm }
.k-mast{ position: relative; height: 70mm; margin-bottom: 8mm }
.k-end{ margin-top: 12mm; border-top: 3mm solid ${c.ink}; padding-top: 3mm; display: flex; justify-content: space-between; gap: 10mm; font-size: 7.4pt; text-transform: uppercase; letter-spacing: .04em; font-weight: 700; break-inside: avoid }
.k-end p{ margin: 0 }
`;
  },

  cover(p, ctx) {
    const { kit } = ctx;
    const c = ctx.theme.colors;
    const W = ctx.pageMm.w, H = ctx.pageMm.h;
    const num = bigNumber(p);
    const title = cap(p.title);
    // Sized to the band, then held to the width it was sized for, so no
    // title runs off the page whatever its glyphs measure.
    const fs = Math.min(40, 200 / Math.max(1, title.length * 0.56));
    const tl = ` textLength="${Math.min(200, title.length * fs * 0.53).toFixed(1)}" lengthAdjust="spacingAndGlyphs"`;
    const pairs = p.pairs.slice(0, 3);
    const [p0, ...pr] = pairs;
    const extraLines = p.lines.slice(3);
    return `<div class="k-cover">
<svg class="lay-svg" viewBox="0 0 ${W} ${H}">
  <circle cx="150" cy="74" r="${num === null ? 76 : 68}" fill="${c.brandOnLight}"/>
  <g transform="rotate(-24.5 105 160)">
    <rect x="-50" y="137" width="320" height="46" fill="${c.ink}"/>
    <text x="3" y="${160 + fs * 0.36}" font-size="${fs.toFixed(1)}" font-weight="900" fill="${c.paper}" style="text-transform:uppercase"${tl}>${kit.esc(p.title)}</text>
    <rect x="-50" y="186" width="320" height="2.2" fill="${c.brandOnLight}"/>
  </g>
  ${rays(p, ctx, 12, H - 13)}
  ${num !== null ? `<text x="11" y="112" font-size="128" font-weight="900" fill="${c.ink}">${num}</text>` : ''}
</svg>
<div class="abs" style="left:108mm;top:36mm;width:72mm;color:${c.paper}">
  ${p0 ? `<div class="k-cap" style="font-size:7.5pt;opacity:.85">${kit.inline(p0[0])}</div><div style="font-weight:900;font-size:19pt;line-height:1">${kit.inline(p0[1])}</div>` : ''}
  <div style="display:flex;gap:9mm;margin-top:3mm">${pr.map(([k, v]) => `<div><div class="k-cap" style="font-size:7.5pt;opacity:.85">${kit.inline(k)}</div><div style="font-weight:900;font-size:19pt;line-height:1">${kit.inline(v)}</div></div>`).join('')}</div>
</div>
<div class="abs k-cap" style="left:14mm;top:122mm;width:60mm;font-size:7.4pt;line-height:1.5">
  ${extraLines.map((l) => `<div>${kit.inline(l)}</div>`).join('')}
</div>
</div>
${p.statement.length ? `<div class="k-statement">${kit.inline(p.statement[0]!)}</div>${p.statement.slice(1).map((s) => `<p class="k-statement-more">${kit.inline(s)}</p>`).join('')}` : ''}`;
  },

  masthead(p, ctx) {
    const { kit } = ctx;
    const c = ctx.theme.colors;
    const w = ctx.pageMm.w - 36;
    return `<div class="k-mast">
<svg class="lay-svg" viewBox="0 0 ${w} 70" style="height:70mm">
  <circle cx="${w - 22}" cy="22" r="22" fill="${c.brandOnLight}"/>
  <polygon points="0,30 ${w - 30},24 ${w - 38},52 0,58" fill="${c.ink}"/>
</svg>
<div class="abs" style="left:5mm;top:33mm;width:${w - 50}mm;color:${c.paper};font-weight:900;font-size:24pt;line-height:.95;text-transform:uppercase">${kit.esc(p.title)}</div>
<div class="abs k-cap" style="left:0;top:4mm;width:${w - 54}mm;font-size:8pt;color:${c.brandOnLight}">${p.lines.map((l) => kit.inline(l)).join('<br>')}</div>
<div class="abs" style="left:0;top:62mm;display:flex;gap:10mm;font-size:8.4pt">${p.pairs.map(([k, v]) => `<span><span class="k-cap" style="font-size:7pt">${kit.inline(k)}</span> ${kit.inline(v)}</span>`).join('')}</div>
</div>`;
  },

  section(s: Section, ctx) {
    const c = ctx.theme.colors;
    if (s.title === '' && s.num === null) return `<section class="k-sec untitled">${s.body}</section>`;
    const wedge = `<svg class="k-wedge" viewBox="0 0 22 16"><polygon points="0,16 22,0 22,6 8,16" fill="${s.index % 2 ? c.ink : c.brandOnLight}"/></svg>`;
    return `<section class="k-sec"><div class="k-head">${s.num ? `<span class="k-num">${s.num}</span>` : ''}<h1 class="k-title">${s.title}</h1>${wedge}</div>${s.body}</section>`;
  },

  gates(g: Gates, ctx) {
    const c = ctx.theme.colors;
    const n = g.rows.length, W = 174, Hh = 112;
    const xs = (i: number) => 12 + (i * (W - 46)) / Math.max(1, n - 1);
    const ys = (i: number) => Hh - 14 - (i * (Hh - 34)) / Math.max(1, n - 1);
    let svg = `<polyline points="${g.rows.map((_, i) => `${xs(i).toFixed(1)},${ys(i).toFixed(1)}`).join(' ')}" fill="none" stroke="${c.ink}" stroke-width="3.2"/>`;
    g.rows.forEach((r, i) => {
      svg += `<circle cx="${xs(i)}" cy="${ys(i)}" r="${i === 0 ? 11 : 9}" fill="${i === 0 ? c.ink : c.brandOnLight}"/>`;
      svg += `<text x="${xs(i)}" y="${ys(i) + 3.6}" font-size="${i === 0 ? 10.5 : 9}" font-weight="900" fill="${c.paper}" text-anchor="middle">${r.code}</text>`;
    });
    const step = (W - 46) / Math.max(1, n - 1);
    const labels = g.rows.map((r, i) => {
      const l = gateLines(g, r);
      const last = i === n - 1;
      const left = last ? xs(i) - 52 : xs(i) + 12, top = last ? ys(i) - 16 - 10 : ys(i) - 6;
      const w = last ? 38 : Math.min(34, step + 12);
      return `<div class="k-gl" style="left:${left.toFixed(1)}mm;top:${Math.max(0, top).toFixed(1)}mm;width:${w.toFixed(1)}mm">${l.date ? `<div class="k-cap" style="font-size:7pt;color:${c.brandOnLight}">${l.date}</div>` : ''}${l.lead ? `<b>${l.lead}</b>` : ''}${l.rest.join('<br>')}</div>`;
    }).join('');
    return `<div class="k-gates"><div class="k-cap" style="position:absolute;left:0;bottom:0;font-size:7pt;color:${c.muted}">${g.head.join(' · ')}</div><svg viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none">${svg}</svg>${labels}</div>`;
  },

  end(p, ctx) {
    if (p.contacts.length === 0 && p.foot.length === 0) return '';
    const { kit } = ctx;
    return `<div class="k-end"><div>${p.contacts.map((l) => `<p>${kit.inline(l)}</p>`).join('')}</div><div style="text-align:right">${p.foot.map((l) => `<p>${kit.inline(l)}</p>`).join('')}</div></div>`;
  },

  footer(ctx, faces) {
    const c = ctx.theme.colors;
    const ref = ctx.doc.meta.reference ?? '';
    return `<style>${faces}</style><div style="width:100%;box-sizing:border-box;padding:0 68px 28px;-webkit-print-color-adjust:exact;display:flex;justify-content:space-between;align-items:center;font-family:'Roboto Condensed',sans-serif;font-size:7pt;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${c.ink}">
<span>${ctx.kit.esc(ctx.doc.meta.title)}${ref ? ` · ${ctx.kit.esc(ref)}` : ''}</span><span style="background:${c.ink};color:${c.paper};font-weight:900;font-size:9pt;padding:2px 8px" class="pageNumber"></span></div>`;
  },
};
