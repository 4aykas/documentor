// In the language of lionfocus.ai, an attack-surface monitoring product:
// magenta graph-paper grid over a near-black (or white) sheet, monospace
// headlines in two tones, corner-bracket reticles around what matters, cards
// with a second outline offset up and to the right, a magenta gradient band
// standing on diagonal hatching, and a radar scope — rings, a tick ring, a
// fading sweep and scattered blips — drawn from the title, so the same
// document always scans the same sky. One layout serves the dark sheet (the
// site's default) and the light one; it reads which from the theme's paper.
// No logo, photograph or illustration of the company is used.

import type { Ctx, CoverParts, Gates, Layout, Section } from './common.js';
import { gateLines, plain } from './common.js';
import { sheetOf } from '../tint.js';

type Pal = { dark: boolean; bg: string; surf: string; surf2: string; line: string; grid: string; ink: string; ink2: string; mut: string; pk: string; hot: string; brand: string };

/** The palette, from the theme: its paper decides dark or light. */
export function palette(ctx: Ctx): Pal {
  const c = ctx.theme.colors;
  // The same sheet test and sheet brand the diagrams drawn into it use.
  const { dark, brand: pk } = sheetOf(c);
  // The magenta the bands and hatching are filled with, on either sheet.
  const brand = c.brandOnLight;
  return dark
    ? { dark, bg: c.paper, surf: '#19171A', surf2: '#231F23', line: 'rgba(255,255,255,.10)', grid: 'rgba(190,60,175,.30)', ink: c.ink, ink2: '#CFC6CD', mut: c.muted, pk, hot: '#FF5FD9', brand }
    : { dark, bg: c.paper, surf: '#FBF7FA', surf2: '#F4EBF2', line: 'rgba(30,0,25,.11)', grid: 'rgba(159,43,146,.12)', ink: c.ink, ink2: '#3D363C', mut: c.muted, pk: brand, hot: brand, brand };
}

function rng(seed: number) { let s = seed % 2147483647 || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
function seedOf(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0;
  return (h % 2147483646) + 1;
}
const f = (n: number) => n.toFixed(2);
const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

/** Corner brackets round a w × h box, in the SVG's own units. */
function brackets(x: number, y: number, w: number, h: number, len: number, stroke: string, sw: number): string {
  const p = (d: string) => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`;
  return p(`M${f(x)} ${f(y + len)}V${f(y)}H${f(x + len)}`) + p(`M${f(x + w - len)} ${f(y)}H${f(x + w)}V${f(y + len)}`)
    + p(`M${f(x + w)} ${f(y + h - len)}V${f(y + h)}H${f(x + w - len)}`) + p(`M${f(x + len)} ${f(y + h)}H${f(x)}V${f(y + h - len)}`);
}

/**
 * A radar scope of radius R centred at (cx, cy): five rings, a crosshair, a
 * tick ring, a sweep fading behind its leading edge, and blips placed by a
 * generator seeded with `seed`. The brightest three wear a reticle.
 */
export function radar(cx: number, cy: number, R: number, seed: number, P: Pal, id: string): string {
  const r = rng(seed);
  let s = `<defs><radialGradient id="${id}glow"><stop offset="0" stop-color="${P.hot}" stop-opacity=".9"/><stop offset="1" stop-color="${P.hot}" stop-opacity="0"/></radialGradient>
<radialGradient id="${id}disc"><stop offset="0" stop-color="${P.brand}" stop-opacity="${P.dark ? 0.22 : 0.08}"/><stop offset="1" stop-color="${P.brand}" stop-opacity="0"/></radialGradient></defs>`;
  s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R)}" fill="url(#${id}disc)"/>`;
  for (const k of [1, 0.8, 0.6, 0.4, 0.2]) {
    s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R * k)}" fill="none" stroke="${P.pk}" stroke-opacity="${k === 1 ? 0.8 : 0.35}" stroke-width="${k === 1 ? 0.45 : 0.25}"/>`;
  }
  s += `<path d="M${f(cx - R * 1.08)} ${f(cy)}H${f(cx + R * 1.08)}M${f(cx)} ${f(cy - R * 1.08)}V${f(cy + R * 1.08)}" stroke="${P.pk}" stroke-opacity=".35" stroke-width=".25" stroke-dasharray="1 1.4"/>`;
  for (let i = 0; i < 120; i++) {
    const major = i % 10 === 0;
    const [x0, y0] = polar(cx, cy, R + 1.2, i * 3), [x1, y1] = polar(cx, cy, R + (major ? 4.4 : 2.4), i * 3);
    s += `<line x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}" stroke="${P.pk}" stroke-opacity="${major ? 0.9 : 0.45}" stroke-width="${major ? 0.4 : 0.2}"/>`;
  }
  // the sweep: thin wedges, each fainter, trailing behind the leading edge
  const lead = 20 + r() * 300;
  for (let i = 0; i < 14; i++) {
    const a1 = lead - i * 3, a0 = a1 - 3.2;
    const [x0, y0] = polar(cx, cy, R, a0), [x1, y1] = polar(cx, cy, R, a1);
    s += `<path d="M${f(cx)} ${f(cy)}L${f(x0)} ${f(y0)}A${f(R)} ${f(R)} 0 0 1 ${f(x1)} ${f(y1)}Z" fill="${P.hot}" fill-opacity="${f(0.34 * (1 - i / 14) ** 1.6)}"/>`;
  }
  const [lx, ly] = polar(cx, cy, R, lead);
  s += `<line x1="${f(cx)}" y1="${f(cy)}" x2="${f(lx)}" y2="${f(ly)}" stroke="${P.hot}" stroke-width=".55"/>`;
  // blips
  const blips = Array.from({ length: 16 }, () => {
    const rad = R * (0.15 + r() * 0.82), a = r() * 360, size = 0.5 + r() * 1.2;
    const [x, y] = polar(cx, cy, rad, a);
    return { x, y, size };
  }).sort((a, b) => b.size - a.size);
  blips.forEach((b, i) => {
    if (i < 3) {
      s += `<circle cx="${f(b.x)}" cy="${f(b.y)}" r="${f(b.size * 4.5)}" fill="url(#${id}glow)" opacity=".55"/>`;
      s += brackets(b.x - 5, b.y - 5, 10, 10, 2.4, P.pk, 0.4);
    }
    s += `<circle cx="${f(b.x)}" cy="${f(b.y)}" r="${f(b.size)}" fill="${i < 3 ? P.hot : P.pk}" fill-opacity="${i < 3 ? 1 : 0.7}"/>`;
  });
  s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="1.1" fill="${P.bg}" stroke="${P.ink}" stroke-width=".5"/>`;
  return s;
}

/** The title in two tones, split after its colon: the words are untouched. */
function twoTone(title: string, esc: (s: string) => string): string {
  const i = title.indexOf(':');
  if (i === -1 || i === title.length - 1) return `<span class="t1">${esc(title)}</span>`;
  return `<span class="t1">${esc(title.slice(0, i + 1))}</span><span class="t2">${esc(title.slice(i + 1).trim())}</span>`;
}

/** Four corner brackets as background layers, for boxes drawn in CSS. */
const cornerBg = (c: string, len = '3mm', w = '.5mm') => [
  `linear-gradient(${c},${c}) left top/${len} ${w}`, `linear-gradient(${c},${c}) left top/${w} ${len}`,
  `linear-gradient(${c},${c}) right top/${len} ${w}`, `linear-gradient(${c},${c}) right top/${w} ${len}`,
  `linear-gradient(${c},${c}) left bottom/${len} ${w}`, `linear-gradient(${c},${c}) left bottom/${w} ${len}`,
  `linear-gradient(${c},${c}) right bottom/${len} ${w}`, `linear-gradient(${c},${c}) right bottom/${w} ${len}`,
].map((l) => `${l} no-repeat`).join(',');

const gridBg = (P: Pal, cell = '8mm') => `background-image: linear-gradient(${P.grid} .25mm, transparent .25mm), linear-gradient(90deg, ${P.grid} .25mm, transparent .25mm); background-size: ${cell} ${cell};`;
const hatch = (P: Pal) => `repeating-linear-gradient(135deg, ${P.brand} 0 .35mm, transparent .35mm 3.6mm)`;
const BAND = 'radial-gradient(120% 120% at 30% 0%, #D443C2 0, #A92C9A 45%, #7E1F73 100%)';
const MONO = `'JetBrains Mono', monospace`;

export const lionfocus: Layout = {
  css(ctx, cover) {
    const P = palette(ctx);
    return `
@page{ margin: 18mm 16mm 20mm 16mm }
${cover ? '@page :first{ margin: 0 }' : ''}
body{ font-size: 9.4pt; line-height: 1.58; color: ${P.ink}; background: ${P.bg} }
.lay-svg{ position: absolute; inset: 0; width: 100%; height: 100%; display: block; overflow: visible }
.abs{ position: absolute }
.lf-eyebrow{ font-family: ${MONO}; font-size: 7pt; font-weight: 700; letter-spacing: .32em; text-transform: uppercase; color: ${P.pk} }
.lf-pill{ display: inline-block; font-family: ${MONO}; font-size: 6.6pt; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: ${P.ink2}; border: .25mm solid ${P.line}; background: ${P.surf}; border-radius: 99mm; padding: 1.4mm 3.4mm; line-height: 1.2 }
.lf-hero{ font-family: ${MONO}; font-weight: 700; letter-spacing: -.02em; line-height: 1.02; margin: 0; display: flex; flex-direction: column; color: ${P.ink} }
.lf-hero .t2{ color: ${P.pk} }

/* cover */
.lf-cover{ position: relative; width: ${ctx.pageMm.w}mm; height: ${ctx.pageMm.h}mm; overflow: hidden; break-after: page; background: ${P.bg}; isolation: isolate }
.lf-cover .grid{ position: absolute; inset: 0; ${gridBg(P)} -webkit-mask-image: linear-gradient(#000 0, #000 55%, transparent 92%) }
.lf-cover .lf-hero{ font-size: 40pt }
.lf-cover .lf-hero .t2{ font-size: 30pt; margin-top: 2mm }
.lf-lines{ margin-top: 6mm; max-width: 120mm; font-size: 11pt; line-height: 1.5; color: ${P.ink2} }
.lf-lines p{ margin: 0 0 2mm }
.lf-index{ font-family: ${MONO}; font-size: 8.4pt; line-height: 1; color: ${P.ink2} }
.lf-index div{ display: grid; grid-template-columns: 9mm 1fr; padding: 2.1mm 0; border-bottom: .2mm solid ${P.line}; width: 74mm }
.lf-index b{ color: ${P.pk}; font-weight: 700 }
.lf-meta{ position: absolute; left: 16mm; right: 16mm; bottom: 20mm; padding: 6mm 7mm; border-radius: 4mm; font-size: 9.6pt; line-height: 1.5 }
.lf-meta p{ margin: 0 } .lf-meta p + p{ margin-top: 1.6mm }
.lf-meta .pairs{ display: flex; gap: 10mm; margin-top: 3mm }
.lf-meta .k{ font-family: ${MONO}; font-size: 6.4pt; letter-spacing: .24em; text-transform: uppercase; opacity: .7 }
.lf-meta .v{ font-weight: 700 }
.lf-meta.framed{ background: ${P.surf}; border: .4mm solid ${P.pk}; color: ${P.ink} }
.lf-meta.framed::after{ content: ''; position: absolute; left: 5mm; right: -3mm; top: -3mm; bottom: 5mm; border: .4mm solid ${P.pk}; border-left: 0; border-bottom: 0; border-radius: 5mm; opacity: .55 }
.lf-meta.band{ background: ${BAND}; color: #FFFFFF; border-radius: 0 4mm 4mm 4mm }
.lf-meta.band::before{ content: ''; position: absolute; z-index: -1; left: 30mm; right: -6mm; top: 6mm; bottom: -6mm; border: .4mm solid ${P.brand}; border-radius: 4mm; background: ${hatch(P)} }
.lf-meta a{ color: inherit }

/* masthead, for a document with no cover */
.lf-mast{ position: relative; height: 92mm; margin: 0 0 9mm; border-radius: 4mm; overflow: hidden; background: ${P.surf}; border: .25mm solid ${P.line}; break-inside: avoid; isolation: isolate }
.lf-mast .grid{ position: absolute; inset: 0; ${gridBg(P, '6mm')} -webkit-mask-image: linear-gradient(90deg, #000 30%, transparent 95%) }
.lf-mast .lf-hero{ font-size: 24pt } .lf-mast .lf-hero .t2{ font-size: 18pt; margin-top: 1.4mm }

/* sections */
.lf-sec{ margin: 0 0 8mm }
.lf-sh{ display: grid; grid-template-columns: 14mm 1fr; align-items: end; gap: 0 4mm; margin: 2mm 0 5mm; break-inside: avoid; break-after: avoid }
.lf-num{ height: 12mm; display: flex; align-items: center; justify-content: center; font-family: ${MONO}; font-weight: 700; font-size: 11pt; color: ${P.pk}; background: ${cornerBg(P.pk, '2.6mm', '.45mm')} }
.lf-sh h1{ font-family: ${MONO}; font-size: 17pt; line-height: 1.12; font-weight: 700; letter-spacing: -.01em; margin: 0; color: ${P.ink} }
.lf-sh .rule{ grid-column: 1 / -1; height: .5mm; margin-top: 3mm; background: linear-gradient(90deg, ${P.brand}, ${P.hot} 40%, ${P.line} 40.1%) }
h2{ font-family: ${MONO}; font-size: 12pt; line-height: 1.25; font-weight: 700; margin: 6mm 0 2.4mm; color: ${P.ink}; break-after: avoid }
h3{ font-family: ${MONO}; font-size: 7.4pt; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; margin: 5mm 0 2mm; color: ${P.pk}; break-after: avoid }
p{ margin: 0 0 2.6mm }
a{ color: ${P.pk}; text-decoration: none; border-bottom: .2mm solid ${P.pk} }
strong{ font-weight: 700; color: ${P.pk} }
code{ font-family: ${MONO}; font-size: .86em; color: ${P.pk}; background: ${P.surf2}; padding: .2mm 1.1mm; border-radius: .8mm }
pre{ font-family: ${MONO}; font-size: 7.2pt; line-height: 1.45; color: ${P.ink2}; background: ${cornerBg(P.pk)}, ${P.surf}; border: .25mm solid ${P.line}; border-radius: 2mm; padding: 5mm 6mm; margin: 3mm 0 5mm; white-space: pre; overflow: hidden; break-inside: avoid }
pre code{ background: none; padding: 0; color: inherit; font-size: inherit }
table{ width: 100%; border-collapse: separate; border-spacing: 0; margin: 3mm 0 6mm; font-size: 8.6pt; line-height: 1.42; background: ${P.surf}; border: .25mm solid ${P.line}; border-radius: 2.4mm; overflow: hidden }
th{ font-family: ${MONO}; font-size: 6.4pt; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: ${P.mut}; text-align: left; padding: 2.6mm 3.4mm; border-bottom: .3mm solid ${P.pk}; background: ${P.surf2} }
td{ padding: 2.4mm 3.4mm; border-top: .2mm solid ${P.line}; vertical-align: top; color: ${P.ink2} }
tr:first-child td{ border-top: 0 }
td:first-child{ color: ${P.ink}; font-weight: 600 }
table.keyvalue td:first-child{ font-family: ${MONO}; font-size: 7pt; letter-spacing: .12em; text-transform: uppercase; color: ${P.mut} }
ul, ol{ margin: 2mm 0 5mm; padding: 0; list-style: none }
ul > li{ position: relative; padding: 0 0 1.6mm 6mm }
ul > li::before{ content: ''; position: absolute; left: .6mm; top: 1.9mm; width: 1.5mm; height: 1.5mm; background: ${P.pk}; transform: rotate(45deg) }
ol{ counter-reset: step }
ol > li{ position: relative; counter-increment: step; padding: .9mm 0 3.2mm 12mm; min-height: 9mm }
ol > li::before{ content: counter(step, decimal-leading-zero); position: absolute; left: 0; top: 0; width: 8mm; height: 7mm; display: flex; align-items: center; justify-content: center; font-family: ${MONO}; font-size: 7.4pt; font-weight: 700; color: ${P.pk}; background: ${cornerBg(P.pk, '1.8mm', '.35mm')}, ${P.surf} }
ol > li:not(:last-child)::after{ content: ''; position: absolute; left: 4mm; top: 7.4mm; bottom: -.4mm; width: .25mm; background: linear-gradient(${P.pk}, ${P.line}) }
blockquote{ position: relative; margin: 6mm 6mm 9mm 0; padding: 6mm 7mm; background: ${BAND}; color: #FFFFFF; border: 0; border-radius: 0 3mm 3mm 3mm; break-inside: avoid }
blockquote::before{ content: ''; position: absolute; z-index: -1; left: 24mm; right: -5mm; top: 5mm; bottom: -5mm; border: .35mm solid ${P.brand}; border-radius: 3mm; background: ${hatch(P)} }
blockquote p{ margin: 0 0 2mm; font-family: ${MONO}; font-size: 10.4pt; line-height: 1.45 } blockquote p:last-child{ margin: 0 }
blockquote strong, blockquote a{ color: #FFFFFF }
hr{ border: 0; height: .4mm; margin: 7mm 0; background: linear-gradient(90deg, ${P.brand}, ${P.hot} 30%, transparent) }
figure.diagram{ margin: 4mm 0 7mm; padding: 7mm 6mm; border-radius: 2.4mm; background: ${cornerBg(P.pk, '4mm', '.5mm')}, radial-gradient(90% 80% at 50% 0%, ${P.dark ? 'rgba(159,43,146,.22)' : 'rgba(159,43,146,.06)'}, transparent 70%), ${P.surf}; border: .25mm solid ${P.line}; break-inside: avoid }
figure.diagram svg{ margin: 0 auto }
/* the label patches on edges take the card's colour, not the sheet's */
figure.diagram .edgeLabel rect, figure.diagram .labelBkg{ fill: ${P.surf} !important }

/* gates as a scan line: a reticle per gate on one track */
.lf-gates{ margin: 5mm 0 7mm; padding: 6mm; border-radius: 3mm; background: ${P.surf}; border: .25mm solid ${P.line}; break-inside: avoid }
.lf-gates .cap{ font-family: ${MONO}; font-size: 6.4pt; letter-spacing: .16em; text-transform: uppercase; color: ${P.mut}; margin-bottom: 5mm }
.lf-gates .track{ display: grid; gap: 4mm; position: relative }
.lf-gates .track::before{ content: ''; position: absolute; left: 0; right: 0; top: 5mm; height: .3mm; background: linear-gradient(90deg, ${P.brand}, ${P.hot}) }
.lf-gates .g{ position: relative }
.lf-gates .code{ position: relative; width: 10mm; height: 10mm; display: flex; align-items: center; justify-content: center; font-family: ${MONO}; font-size: 8pt; font-weight: 700; color: ${P.pk}; background: ${cornerBg(P.pk, '2.2mm', '.4mm')}, ${P.bg}; margin-bottom: 3mm }
.lf-gates .date{ font-family: ${MONO}; font-size: 6.8pt; color: ${P.mut} }
.lf-gates .lead{ font-weight: 700; color: ${P.ink}; line-height: 1.3; margin: 1mm 0 }
.lf-gates .rest{ font-size: 7.8pt; line-height: 1.4; color: ${P.ink2} }

/* the close */
.lf-end{ position: relative; margin: 12mm 8mm 10mm 0; padding: 7mm 8mm; background: ${BAND}; color: #FFFFFF; border-radius: 0 3mm 3mm 3mm; break-inside: avoid; font-size: 9pt }
.lf-end::before{ content: ''; position: absolute; z-index: -1; left: 30mm; right: -6mm; top: 6mm; bottom: -6mm; border: .35mm solid ${P.brand}; border-radius: 3mm; background: ${hatch(P)} }
.lf-end p{ margin: 0 } .lf-end p + p{ margin-top: 1.4mm }
.lf-end a{ color: #FFFFFF; border-color: #FFFFFF }
`;
  },

  cover(p, ctx) {
    const { kit } = ctx;
    const P = palette(ctx);
    const W = ctx.pageMm.w, H = ctx.pageMm.h;
    const seed = seedOf(p.title + (ctx.doc.meta.reference ?? ''));
    const pairs = p.pairs.length
      ? `<div class="pairs">${p.pairs.map(([k, v]) => `<div><div class="k">${kit.inline(k)}</div><div class="v">${kit.inline(v)}</div></div>`).join('')}</div>`
      : '';
    const meta = p.contacts.length || p.pairs.length
      ? `<div class="lf-meta ${P.dark ? 'framed' : 'band'}">${p.contacts.map((l) => `<p>${kit.inline(l)}</p>`).join('')}${pairs}</div>`
      : '';
    const index = ctx.sectionTitles.length
      ? `<div class="abs lf-index" style="left:16mm;top:${p.lines.length ? 128 : 112}mm">${ctx.sectionTitles.slice(0, 12).map((t, i) => `<div><b>${String(i + 1).padStart(2, '0')}</b><span>${kit.esc(t)}</span></div>`).join('')}${ctx.sectionTitles.length > 12 ? '<div><b>…</b><span></span></div>' : ''}</div>`
      : '';
    return `<div class="lf-cover"><div class="grid"></div>
<svg class="lay-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${radar(W * 0.7, H * 0.56, W * 0.36, seed, P, 'cv')}${brackets(10, 10, W - 20, H - 20, 9, P.pk, 0.6)}</svg>
<div class="abs" style="left:16mm;top:22mm"><span class="lf-eyebrow">${ctx.doc.meta.entity ? kit.esc(ctx.doc.meta.entity) : ''}</span></div>
<div class="abs" style="left:16mm;right:16mm;top:${ctx.doc.meta.entity ? 34 : 28}mm">
  <h1 class="lf-hero">${twoTone(p.title, kit.esc)}</h1>
  ${p.lines.length ? `<div class="lf-lines">${p.lines.map((l) => `<p>${kit.inline(l)}</p>`).join('')}</div>` : ''}
</div>
${index}
${meta}
${p.statement.length ? `<div class="abs" style="left:16mm;width:96mm;bottom:${meta ? 62 : 24}mm"><blockquote style="margin:0">${p.statement.map((s) => `<p>${kit.inline(s)}</p>`).join('')}</blockquote></div>` : ''}
</div>`;
  },

  masthead(p, ctx) {
    const { kit } = ctx;
    const P = palette(ctx);
    const w = ctx.pageMm.w - 32;
    return `<div class="lf-mast"><div class="grid"></div>
<svg class="lay-svg" viewBox="0 0 ${w} 92" preserveAspectRatio="xMidYMid slice">${radar(w - 30, 50, 42, seedOf(p.title), P, 'mh')}</svg>
<div class="abs" style="left:7mm;top:7mm;display:flex;gap:2mm;flex-wrap:wrap">${p.pairs.map(([k, v]) => `<span class="lf-pill">${kit.inline(k)} · ${kit.inline(v)}</span>`).join('')}</div>
<div class="abs" style="left:7mm;right:70mm;bottom:8mm">
  ${ctx.doc.meta.entity ? `<div class="lf-eyebrow" style="margin-bottom:3mm">${kit.esc(ctx.doc.meta.entity)}</div>` : ''}
  <h1 class="lf-hero">${twoTone(p.title, kit.esc)}</h1>
  ${p.lines.map((l) => `<div style="font-size:10pt;margin-top:2.4mm;color:${P.ink2}">${kit.inline(l)}</div>`).join('')}
</div></div>`;
  },

  section(s: Section) {
    if (s.title === '' && s.num === null) return `<section class="lf-sec">${s.body}</section>`;
    return `<section class="lf-sec"><header class="lf-sh"><div class="lf-num">${s.num ?? ''}</div><h1>${s.title}</h1><div class="rule"></div></header>${s.body}</section>`;
  },

  gates(g: Gates) {
    const cols = `grid-template-columns: repeat(${g.rows.length}, 1fr)`;
    return `<div class="lf-gates"><div class="cap">${g.head.join(' · ')}</div><div class="track" style="${cols}">${g.rows.map((r) => {
      const l = gateLines(g, r);
      return `<div class="g"><div class="code">${r.code}</div>${l.date ? `<div class="date">${l.date}</div>` : ''}${l.lead ? `<div class="lead">${l.lead}</div>` : ''}${l.rest.length ? `<div class="rest">${l.rest.join('<br>')}</div>` : ''}</div>`;
    }).join('')}</div></div>`;
  },

  end(p, ctx) {
    // On a cover the contacts are already on the first page; only the foot
    // is left to close with.
    const lines = ctx.doc.meta.cover === true ? p.foot : [...p.contacts, ...p.foot];
    if (lines.length === 0) return '';
    return `<div class="lf-end">${lines.map((l) => `<p>${ctx.kit.inline(l)}</p>`).join('')}</div>`;
  },

  footer(ctx, faces) {
    const P = palette(ctx);
    const ref = ctx.doc.meta.reference ?? '';
    return `<style>${faces}</style><div style="width:100%;box-sizing:border-box;padding:0 60px 24px;display:flex;justify-content:space-between;align-items:center;font-family:'JetBrains Mono',monospace;font-size:6.2pt;letter-spacing:.14em;color:${P.ink2}">
<span style="text-transform:uppercase">${ctx.kit.esc(plain([{ t: 'text', v: ctx.doc.meta.title }]))}${ref ? ` · ${ctx.kit.esc(ref)}` : ''}</span><span style="color:${P.pk};font-weight:700">[ <span class="pageNumber"></span> / <span class="totalPages"></span> ]</span></div>`;
  },
};
