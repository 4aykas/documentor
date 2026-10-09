// "Weniger, aber besser." The page as a Braun appliance: the cover is a front
// panel — speaker grille, tuning wheel, one coloured switch, and a tuning
// scale whose stations are the document's gates when it has any. Inside, one
// grid like a 606 shelf: a label column carrying each section's number and
// name, a text column in one quiet size, hairlines, and the single accent
// spent only where the eye should go first.

import type { Ctx, CoverParts, Gates, Layout, Section } from './common.js';
import { bigNumber, capsClass, gateLines, plain } from './common.js';

const K = { body: '#E8E7E2', hair: '#CFCEC8', switchRim: '#C98A00' };

function grille(x: number, y: number, w: number, h: number, ink: string, pitch = 3.2, r = 0.78): string {
  const cols = Math.floor(w / pitch), rows = Math.floor(h / pitch);
  const ox = x + (w - (cols - 1) * pitch) / 2, oy = y + (h - (rows - 1) * pitch) / 2;
  let s = '';
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) s += `<circle cx="${(ox + i * pitch).toFixed(2)}" cy="${(oy + j * pitch).toFixed(2)}" r="${r}"/>`;
  return `<g fill="${ink}">${s}</g>`;
}

/** Stations along a tuning scale: by month when the gates carry dates, else evenly. */
function stations(g: Gates, x0: number, x1: number): number[] {
  const months = g.rows.map((r) => r.month);
  const span = months.every((m) => m !== null) ? Math.max(1, ...(months as number[])) : null;
  return g.rows.map((r, i) => {
    const t = span === null ? i / Math.max(1, g.rows.length - 1) : (r.month as number) / span;
    return x0 + 4 + t * (x1 - x0 - 12);
  });
}

function scaleSvg(g: Gates, x0: number, x1: number, y: number, c: Ctx['theme']['colors'], big: boolean): { svg: string; xs: number[] } {
  const xs = stations(g, x0, x1);
  let t = `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${c.ink}" stroke-width="0.25"/>`;
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const x = x0 + 4 + (i / n) * (x1 - x0 - 8);
    const h = i % 6 === 0 ? (big ? 4.2 : 3.2) : big ? 2 : 1.5;
    t += `<line x1="${x.toFixed(2)}" y1="${y}" x2="${x.toFixed(2)}" y2="${(y - h).toFixed(2)}" stroke="${c.ink}" stroke-width="0.2"/>`;
  }
  g.rows.forEach((r, i) => {
    t += `<text x="${(xs[i]! + 1.2).toFixed(2)}" y="${y - (big ? 5.4 : 4.2)}" font-size="${big ? 3.4 : 2.8}" font-weight="700" fill="${c.ink}">${r.code}</text>`;
  });
  t += `<rect x="${(xs[0]! - 0.35).toFixed(2)}" y="${y - (big ? 13 : 10)}" width="0.7" height="${big ? 16 : 12.5}" fill="${c.brandOnLight}"/>`;
  return { svg: t, xs };
}

function wheel(cx: number, cy: number, R: number, num: string | null, c: Ctx['theme']['colors']): string {
  let s = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${K.body}"/>`;
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 - Math.PI / 2, l = i % 5 === 0 ? 3 : 1.4;
    s += `<line x1="${(cx + Math.cos(a) * (R - 2)).toFixed(2)}" y1="${(cy + Math.sin(a) * (R - 2)).toFixed(2)}" x2="${(cx + Math.cos(a) * (R - 2 - l)).toFixed(2)}" y2="${(cy + Math.sin(a) * (R - 2 - l)).toFixed(2)}" stroke="${c.ink}" stroke-width="${i % 5 === 0 ? 0.3 : 0.18}"/>`;
  }
  if (num !== null) s += `<text x="${cx}" y="${cy + 5.6}" font-size="16" fill="${c.ink}" text-anchor="middle">${num}</text>`;
  else s += `<circle cx="${cx}" cy="${cy - R * 0.55}" r="1.6" fill="${c.brandOnLight}"/>`;
  return s;
}

export const rams: Layout = {
  css(ctx, cover) {
    const c = ctx.theme.colors;
    return `
@page{ margin: 22mm 20mm 24mm 20mm }
${cover ? '@page :first{ margin: 0 }' : ''}
body{ font-size: 8.6pt; line-height: 1.5; }
.src-caps{ text-transform: lowercase } .src-caps::first-letter{ text-transform: uppercase }
.lay-svg{ position: absolute; inset: 0; width: 100%; height: 100% }
.abs{ position: absolute }
.lab{ font-size: 6.4pt; color: ${c.muted}; letter-spacing: .02em }
.r-cover{ position: relative; width: ${ctx.pageMm.w}mm; height: ${ctx.pageMm.h}mm; overflow: hidden; break-after: page }
.r-sec{ padding-left: 44mm; margin: 0 0 9mm; }
.r-sec::after{ content: ''; display: block; clear: both }
.r-head{ float: left; width: 38mm; margin-left: -44mm; break-after: avoid }
.r-num{ font-size: 6.4pt; color: ${c.muted}; font-variant-numeric: tabular-nums }
.r-title{ font-size: 8.6pt; font-weight: 700; line-height: 1.35; margin: 0 }
.r-lead{ font-size: 13pt; line-height: 1.32; letter-spacing: -.005em; margin: 0 0 4mm }
.r-lead + .r-lead-more{ color: ${c.muted} }
h2, h3{ font-size: 8.6pt; font-weight: 700; margin: 5mm 0 1.6mm; line-height: 1.35 }
h3{ color: ${c.muted} }
p{ margin: 0 0 2.2mm }
blockquote{ border-left: .6mm solid ${c.brandOnLight}; padding: 0 0 0 4mm; margin: 4mm 0; color: ${c.ink}; font-size: 9.4pt; line-height: 1.45; background: none }
table{ font-size: 7.6pt; line-height: 1.38; margin: 4mm 0 }
th{ font-weight: 400; color: ${c.muted}; font-size: 6.4pt; text-transform: lowercase; border-bottom: .25mm solid ${c.ink}; background: none; padding: 0 2.5mm 1.6mm 0 }
td{ border-bottom: .2mm solid ${K.hair}; padding: 1.9mm 2.5mm 1.9mm 0 }
td:first-child{ font-weight: 700 }
table.keyvalue td:first-child{ font-weight: 400 }
ul, ol{ list-style: none; padding: 0; margin: 2mm 0 3mm }
ul > li{ position: relative; padding: 1.6mm 0 1.6mm 5mm; border-top: .2mm solid ${K.hair} }
ul > li::before{ content: ''; position: absolute; left: 0; top: 3.5mm; width: 2.2mm; height: .25mm; background: ${c.ink} }
ol{ counter-reset: k }
ol > li{ counter-increment: k; position: relative; padding: 2.4mm 0 2.4mm 11mm; border-top: .2mm solid ${K.hair}; min-height: 11mm }
ol > li::before{ content: counter(k); position: absolute; left: 0; top: 2mm; width: 7mm; height: 7mm; border-radius: 50%; background: ${c.ink}; color: ${c.paper}; font-weight: 700; font-size: 7.5pt; display: flex; align-items: center; justify-content: center }
ol > li:first-child::before{ background: ${c.brandOnLight}; color: ${c.ink} }
ol[start] > li:first-child::before{ background: ${c.ink}; color: ${c.paper} }
hr{ border: 0; border-top: .2mm solid ${K.hair}; margin: 5mm 0 }
.r-gates{ position: relative; margin: 6mm 0 7mm; break-inside: avoid }
.r-gates svg{ display: block; width: 100%; height: auto }
.r-gate-cols{ display: grid; gap: 3mm; font-size: 7.3pt; line-height: 1.38; margin-top: 1mm }
.r-gate-cols b{ display: block; margin: .6mm 0 1mm }
.r-mast{ position: relative; height: 62mm; margin-bottom: 8mm }
.r-end{ border-top: .25mm solid ${c.ink}; padding-top: 3mm; margin: 10mm 0 0 44mm; display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; font-size: 7.6pt; break-inside: avoid }
.r-end p{ margin: 0 }
`;
  },

  cover(p, ctx) {
    const { kit } = ctx;
    const c = ctx.theme.colors;
    const W = ctx.pageMm.w, H = ctx.pageMm.h;
    const num = bigNumber(p);
    const scale = ctx.gates ? scaleSvg(ctx.gates, 20, W - 20, H - 45, c, false) : null;
    const pairs = p.pairs.slice(0, 3);
    const [first, ...more] = p.lines;
    return `<div class="r-cover">
<svg class="lay-svg" viewBox="0 0 ${W} ${H}">
  <rect x="20" y="20" width="${W - 40}" height="104" rx="5" fill="${K.body}"/>
  ${grille(26, 26, W - 52, 92, c.ink)}
  ${wheel(W - 50, 168, 24, num, c)}
  <circle cx="26.5" cy="216" r="5.2" fill="${c.brandOnLight}"/>
  <circle cx="26.5" cy="216" r="5.2" fill="none" stroke="${K.switchRim}" stroke-width="0.2"/>
  ${scale?.svg ?? ''}
</svg>
<div class="abs" style="left:20mm;top:136mm;width:${W - 100}mm">
  <div class="${capsClass(p.title).trim()}" style="font-size:28pt;line-height:1.05;letter-spacing:-.02em">${kit.esc(p.title)}</div>
  ${first ? `<div class="${capsClass(plain(first)).trim()}" style="margin-top:4mm;font-size:9pt">${kit.inline(first)}</div>` : ''}
  ${more.map((l) => `<div class="${capsClass(plain(l)).trim()}" style="color:${c.muted};font-size:8.6pt">${kit.inline(l)}</div>`).join('')}
</div>
<div class="abs" style="left:40mm;top:211mm;display:grid;grid-template-columns:repeat(${Math.max(1, pairs.length)},40mm)">
  ${pairs.map(([k, v]) => `<div><div class="lab">${kit.inline(k)}</div><div>${kit.inline(v)}</div></div>`).join('')}
</div>
${scale && ctx.gates ? ctx.gates.rows.map((r, i) => { const d = gateLines(ctx.gates!, r).date; return d ? `<div class="abs lab" style="left:${(scale.xs[i]! + 1.2).toFixed(2)}mm;top:${H - 42.5}mm;width:26mm">${d}</div>` : ''; }).join('') : ''}
<div class="abs lab" style="left:20mm;right:20mm;bottom:12mm;display:flex;justify-content:space-between;gap:10mm">
  <span>${p.contacts.map((l) => kit.inline(l)).join(' · ')}</span><span style="text-align:right">${p.foot.map((l) => kit.inline(l)).join(' · ')}</span>
</div>
</div>
${p.statement.length ? `<div class="r-sec"><div class="r-head"></div>${p.statement.map((s, i) => `<p class="${i === 0 ? 'r-lead' : 'r-lead-more'}">${kit.inline(s)}</p>`).join('')}</div>` : ''}`;
  },

  masthead(p, ctx) {
    const { kit } = ctx;
    const c = ctx.theme.colors;
    const w = ctx.pageMm.w - 40;
    return `<div class="r-mast">
<svg class="lay-svg" viewBox="0 0 ${w} 62" style="height:62mm">
  <rect x="0" y="0" width="${w}" height="22" rx="3" fill="${K.body}"/>${grille(4, 3, w - 8, 16, c.ink)}
  <circle cx="${w - 4}" cy="57" r="3" fill="${c.brandOnLight}"/>
</svg>
<div class="abs" style="left:0;top:28mm;width:${w - 20}mm">
  <div class="${capsClass(p.title).trim()}" style="font-size:22pt;line-height:1.05;letter-spacing:-.02em">${kit.esc(p.title)}</div>
  ${p.lines.map((l) => `<div class="${capsClass(plain(l)).trim()}" style="color:${c.muted};margin-top:1.4mm">${kit.inline(l)}</div>`).join('')}
</div>
<div class="abs" style="left:0;top:50mm;display:flex;gap:10mm">${p.pairs.map(([k, v]) => `<div><div class="lab">${kit.inline(k)}</div>${kit.inline(v)}</div>`).join('')}</div>
</div>`;
  },

  section(s: Section) {
    const head = s.title === '' && s.num === null ? '<div class="r-head"></div>'
      : `<div class="r-head">${s.num ? `<div class="r-num">${s.num}</div>` : ''}<h1 class="r-title">${s.title}</h1></div>`;
    return `<section class="r-sec">${head}${s.body}</section>`;
  },

  gates(g, ctx) {
    const c = ctx.theme.colors;
    const w = 126;
    const sc = scaleSvg(g, 0, w, 18, c, true);
    const n = g.rows.length;
    return `<div class="r-gates"><div class="lab">${g.head.join(' · ')}</div><svg viewBox="0 0 ${w} 24">${sc.svg}</svg>
<div class="r-gate-cols" style="grid-template-columns:repeat(${n},1fr)">${g.rows.map((r) => {
      const l = gateLines(g, r);
      return `<div><div class="lab">${l.date ?? ''}</div><b>${l.lead ?? ''}</b>${l.rest.join('<br>')}</div>`;
    }).join('')}</div></div>`;
  },

  end(p, ctx) {
    // A cover already carries these lines along its foot.
    if (ctx.doc.meta.cover === true || (p.contacts.length === 0 && p.foot.length === 0)) return '';
    const { kit } = ctx;
    return `<div class="r-end"><div>${p.contacts.map((l) => `<p>${kit.inline(l)}</p>`).join('')}</div><div>${p.foot.map((l) => `<p>${kit.inline(l)}</p>`).join('')}</div></div>`;
  },

  footer(ctx, faces) {
    const c = ctx.theme.colors;
    const ref = ctx.doc.meta.reference ?? ctx.doc.meta.date ?? '';
    return `<style>${faces}</style><div style="width:100%;box-sizing:border-box;padding:0 76px 30px;-webkit-print-color-adjust:exact"><div style="border-top:0.75px solid ${K.hair};padding-top:7px;display:flex;justify-content:space-between;font-family:Arimo,Arial,sans-serif;font-size:6.4pt;color:${c.muted};text-transform:lowercase">
<span>${ctx.kit.esc(ctx.doc.meta.title)}</span><span>${ctx.kit.esc(ref)}</span><span class="pageNumber"></span></div></div>`;
  },
};
