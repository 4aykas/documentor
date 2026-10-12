// Generative "dreams" in the manner of a contemporary-art exhibition identity:
// stacks of discs that step round into a spiral or sink into a tunnel, in a
// sunrise ramp from indigo through magenta to orange; titles in a screen-pixel
// face; data-style labels in a monospace — the document's own words set as
// snake_case keys and [ bracketed ] tags; black interface panels with thin
// outlined boxes. Every document draws its own dream: the picture is seeded by
// the title, each section's by its title, so no two covers are the same.
// No artwork, mark or name of any museum or agency is used.

import type { Ctx, CoverParts, Gates, Layout, Section } from './common.js';
import { gateLines, plain } from './common.js';

const C = { night: '#0A0820', black: '#07070B', white: '#FFFFFF', coral: '#FF6F59', magenta: '#E23DC4', indigo: '#2A1FD6', violet: '#7B2FF0', haze: '#B9B3D6' };
const RAMP = ['#140B52', '#2A1FD6', '#5A27EC', '#9A34E6', '#E23DC4', '#FF4F8B', '#FF6A3D', '#FF9C55', '#FFD2A6'];

function rng(seed: number) { let s = seed % 2147483647 || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
/** A stable number from text, so the same title always dreams the same picture. */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0;
  return (h % 2147483646) + 1;
}

function mix(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return '#' + [0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, '0')).join('');
}
/** A colour on the sunrise ramp, t in 0..1. */
function ramp(t: number): string {
  const x = Math.min(0.9999, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.floor(x);
  return mix(RAMP[i]!, RAMP[i + 1]!, x - i);
}

const f = (n: number) => n.toFixed(2);

/**
 * One dream, w × h in the SVG's own units. `spiral` stacks notched discs that
 * turn a step each, so their edges climb round like a staircase; `tunnel`
 * stacks whole discs whose centres drift, so the picture sinks away; `ripple`
 * draws the tunnel's rings as lines over a plain field.
 */
export function dream(w: number, h: number, seed: number, id: string, mode?: 'spiral' | 'tunnel' | 'ripple'): string {
  const r = rng(seed);
  const kind = mode ?? (['spiral', 'tunnel', 'spiral', 'ripple'] as const)[Math.floor(r() * 4)]!;
  const cx = w * (0.3 + r() * 0.4), cy = h * (0.3 + r() * 0.4);
  const R = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) * 1.08;
  const n = kind === 'ripple' ? 34 : 30;
  const turn = (r() < 0.5 ? -1 : 1) * (9 + r() * 7);
  const a0 = r() * 360;
  const drift = Math.min(w, h) * (0.1 + r() * 0.16);
  const phase = r() * Math.PI * 2;
  const warm = r() < 0.5; // which end of the ramp sits at the centre
  const bg = warm ? ramp(0.1) : ramp(0.92);
  let s = `<defs><linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ramp(warm ? 0.05 : 0.95)}"/><stop offset="1" stop-color="${ramp(warm ? 0.3 : 0.6)}"/></linearGradient></defs>`;
  s += `<rect width="${f(w)}" height="${f(h)}" fill="${kind === 'ripple' ? C.night : `url(#${id}g)`}"/>`;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const rad = R * (1 - t * 0.94);
    const ox = cx + Math.cos(phase + t * 2.4) * drift * t;
    const oy = cy + Math.sin(phase + t * 2.4) * drift * t;
    const col = ramp(warm ? 0.08 + t * 0.9 : 0.98 - t * 0.9);
    if (kind === 'spiral') {
      // a disc with a wedge cut out, the wedge turning a step per disc
      const a = ((a0 + i * turn) * Math.PI) / 180;
      const sweep = (300 * Math.PI) / 180;
      const p1x = ox + Math.cos(a) * rad, p1y = oy + Math.sin(a) * rad;
      const p2x = ox + Math.cos(a + sweep) * rad, p2y = oy + Math.sin(a + sweep) * rad;
      s += `<path d="M${f(ox)},${f(oy)}L${f(p1x)},${f(p1y)}A${f(rad)},${f(rad)} 0 1 1 ${f(p2x)},${f(p2y)}Z" fill="${col}"/>`;
    } else if (kind === 'tunnel') {
      s += `<circle cx="${f(ox)}" cy="${f(oy)}" r="${f(rad)}" fill="${col}"/>`;
    } else {
      s += `<circle cx="${f(ox)}" cy="${f(oy)}" r="${f(rad)}" fill="none" stroke="${col}" stroke-width="${f(Math.max(0.35, (1 - t) * Math.min(w, h) * 0.012))}"/>`;
    }
  }
  return s;
}

/** The document's words as a data key: "Delivery approach" → DELIVERY_APPROACH. */
export const snake = (s: string) => s.normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').toUpperCase();

const tag = (html: string) => `<span class="d-tag">[ ${html} ]</span>`;

export const dreamscape: Layout = {
  css(ctx, cover) {
    const c = ctx.theme.colors;
    return `
@page{ margin: 18mm 17mm 22mm 17mm }
${cover ? '@page :first{ margin: 0 }' : ''}
body{ font-size: 9.4pt; line-height: 1.5 }
.lay-svg{ position: absolute; inset: 0; width: 100%; height: 100%; display: block }
.abs{ position: absolute }
.d-px{ font-family: 'Pixelify Sans', ${ctx.theme.font.document}, sans-serif; font-weight: 400; letter-spacing: .01em }
.d-mono{ font-family: 'JetBrains Mono', monospace; font-size: 6.8pt; line-height: 1.5; letter-spacing: .02em }
.d-tag{ display: inline-block; font-family: 'JetBrains Mono', monospace; font-size: 6.4pt; letter-spacing: .06em; text-transform: uppercase; border: .25mm solid currentColor; padding: 1mm 2mm; line-height: 1.2; white-space: nowrap }
.d-cover{ position: relative; width: ${ctx.pageMm.w}mm; height: ${ctx.pageMm.h}mm; overflow: hidden; break-after: page; color: ${C.white}; background: ${C.night} }
.d-title{ font-size: 64pt; line-height: .98; margin: 0; text-wrap: balance }
.d-mark{ display: grid; grid-template-columns: 4.2mm 1fr; gap: 0 2mm; font-size: 7pt; line-height: 1.25; font-weight: 700 }
.d-mark b{ font-weight: 700 }
.d-lead{ background: ${C.black}; color: ${C.white}; padding: 6mm; margin: 0 0 8mm }
.d-lead .box{ border: .25mm solid ${C.white}; padding: 6mm 7mm; color: ${C.coral}; font-size: 12pt; line-height: 1.4 }
.d-lead p{ margin: 0 0 2mm } .d-lead p:last-child{ margin: 0 }
.d-sec{ margin: 0 0 9mm }
.d-band{ position: relative; height: 38mm; overflow: hidden; margin: 0 0 6mm; break-inside: avoid; break-after: avoid; color: ${C.white} }
.d-band .num{ position: absolute; left: 5mm; top: 4mm }
.d-band .key{ position: absolute; right: 5mm; top: 4.4mm; max-width: 60%; text-align: right; overflow-wrap: anywhere }
.d-band h1{ position: absolute; left: 5mm; right: 5mm; bottom: 4.4mm; margin: 0; font-size: 22pt; line-height: 1.05; color: ${C.white}; text-wrap: balance }
h2{ font-size: 14pt; line-height: 1.2; font-weight: 700; margin: 6mm 0 2mm; break-after: avoid }
h3{ font-family: 'JetBrains Mono', monospace; font-size: 7.2pt; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; margin: 5mm 0 1.6mm; break-after: avoid }
h3::before{ content: '[ '; color: ${C.magenta} } h3::after{ content: ' ]'; color: ${C.magenta} }
p{ margin: 0 0 2.4mm }
strong{ font-weight: 700 }
blockquote{ background: ${C.black}; color: ${C.white}; border: 0; padding: 5mm; margin: 5mm 0; break-inside: avoid }
blockquote > *{ border-left: 0 }
blockquote p{ margin: 0 0 2mm; color: ${C.coral}; font-family: 'Pixelify Sans', sans-serif; font-size: 11pt; line-height: 1.4 }
blockquote p:last-child{ margin: 0 }
table{ font-size: 8.4pt; line-height: 1.4; margin: 4mm 0; border: .3mm solid ${c.ink}; border-collapse: collapse }
th{ font-family: 'JetBrains Mono', monospace; font-size: 6.6pt; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; background: ${C.black}; color: ${C.white}; border: 0; padding: 2mm 3mm }
td{ border: 0; border-top: .2mm solid ${mix(c.ink, '#FFFFFF', 0.72)}; padding: 2.2mm 3mm }
table.keyvalue td:first-child{ font-family: 'JetBrains Mono', monospace; font-size: 7pt; letter-spacing: .03em; text-transform: uppercase; color: ${c.muted} }
ul, ol{ padding: 0; margin: 2mm 0 4mm; list-style: none }
ul > li, ol > li{ position: relative; padding: 0 0 1.4mm 6mm }
ul > li::before{ content: '•'; position: absolute; left: 0; top: 0; color: ${C.magenta}; font-family: 'JetBrains Mono', monospace; font-weight: 700 }
ol{ counter-reset: k }
ol > li{ counter-increment: k; padding-left: 9mm }
ol > li::before{ content: '[' counter(k, decimal-leading-zero) ']'; position: absolute; left: 0; top: .5mm; font-family: 'JetBrains Mono', monospace; font-size: 6.8pt; font-weight: 700; color: ${C.indigo} }
hr{ border: 0; border-top: .25mm solid ${c.ink}; margin: 6mm 0 }
.d-gates{ background: ${C.black}; color: ${C.white}; padding: 6mm; margin: 5mm 0; display: grid; grid-template-columns: 62mm 1fr; gap: 6mm; break-inside: avoid }
.d-gates .rings{ position: relative; width: 62mm; height: 62mm }
.d-gates .row{ border: .25mm solid rgba(255,255,255,.7); padding: 2.4mm 3mm; margin-bottom: 2mm; display: grid; grid-template-columns: 10mm 1fr; gap: 3mm }
.d-gates .code{ font-family: 'Pixelify Sans', sans-serif; font-size: 15pt; line-height: 1; color: ${C.coral} }
.d-mast{ position: relative; height: 70mm; overflow: hidden; margin: 0 0 8mm; color: ${C.white}; break-inside: avoid }
.d-end{ margin-top: 12mm; background: ${C.black}; color: ${C.white}; padding: 6mm; display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; break-inside: avoid; font-size: 8.4pt }
.d-end .box{ border: .25mm solid rgba(255,255,255,.75); padding: 4mm 5mm }
`;
  },

  cover(p, ctx) {
    const { kit } = ctx;
    const W = ctx.pageMm.w, H = ctx.pageMm.h;
    const seed = seedOf(p.title + (ctx.doc.meta.reference ?? ''));
    const head = p.lines[0] ? plain(p.lines[0]) : p.title;
    const keys = ctx.sectionTitles.slice(0, 9);
    const date = p.pairs.find(([k]) => /date|дата/i.test(plain(k)));
    const entity = ctx.doc.meta.entity ?? '';
    const words = entity.split(/\s+/).filter(Boolean).slice(0, 4);
    return `<div class="d-cover">
<svg class="lay-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${dream(W, H, seed, 'cv')}</svg>
<div class="abs d-mono" style="left:14mm;top:13mm;width:92mm">
  <div style="font-size:9.4pt;font-weight:700;letter-spacing:.04em;overflow-wrap:anywhere">${kit.esc(snake(head))}</div>
  ${date ? `<div style="font-size:8pt;margin-bottom:3mm">${kit.inline(date[0])}: ${kit.inline(date[1])}</div>` : ''}
  ${keys.map((k, i) => `<div>• ${String(i + 1).padStart(2, '0')}_${kit.esc(snake(k).toLowerCase())}</div>`).join('')}
</div>
<div class="abs" style="right:14mm;top:13mm;display:flex;flex-direction:column;align-items:flex-end;gap:2mm">${p.pairs.filter((pr) => pr !== date).slice(0, 4).map(([k, v]) => tag(`${kit.inline(k)}: ${kit.inline(v)}`)).join('')}</div>
<div class="abs" style="left:14mm;right:14mm;top:78mm">
  <h1 class="d-px d-title">${kit.esc(p.title)}</h1>
  ${p.lines.slice(p.lines[0] && plain(p.lines[0]) !== p.title ? 0 : 1).map((l) => `<div class="d-px" style="font-size:17pt;line-height:1.2;margin-top:3mm">${kit.inline(l)}</div>`).join('')}
</div>
${p.statement[0] ? `<div class="abs" style="left:14mm;bottom:40mm;width:96mm;background:${C.black};padding:4mm"><div style="border:.25mm solid ${C.white};padding:4mm 5mm;color:${C.coral};font-size:10.4pt;line-height:1.4" class="d-px">${kit.inline(p.statement[0])}</div></div>` : ''}
<div class="abs d-mark" style="left:14mm;bottom:13mm">${words.map((w) => `<b>${kit.esc(w[0]!.toUpperCase())}</b><span>${kit.esc(w)}</span>`).join('')}${entity.split(/\s+/).length > words.length ? `<b></b><span>${kit.esc(entity.split(/\s+/).slice(words.length).join(' '))}</span>` : ''}</div>
${p.contacts.length ? `<div class="abs d-mono" style="right:14mm;bottom:13mm;text-align:right;max-width:80mm">${p.contacts.map((l) => `<div>${kit.inline(l)}</div>`).join('')}</div>` : ''}
</div>
${p.statement.length > 1 ? `<div class="d-lead"><div class="box d-px">${p.statement.slice(1).map((s) => `<p>${kit.inline(s)}</p>`).join('')}</div></div>` : ''}`;
  },

  masthead(p, ctx) {
    const { kit } = ctx;
    const w = ctx.pageMm.w - 34;
    return `<div class="d-mast"><svg class="lay-svg" viewBox="0 0 ${w} 70" preserveAspectRatio="none">${dream(w, 70, seedOf(p.title), 'mh')}</svg>
<div class="abs d-mono" style="left:5mm;top:4mm;font-weight:700;font-size:7.6pt">${kit.esc(snake(p.lines[0] ? plain(p.lines[0]) : p.title))}</div>
<div class="abs" style="right:5mm;top:4mm;display:flex;gap:2mm">${p.pairs.map(([k, v]) => tag(`${kit.inline(k)}: ${kit.inline(v)}`)).join('')}</div>
<div class="abs" style="left:5mm;right:5mm;bottom:5mm"><h1 class="d-px d-title" style="font-size:30pt">${kit.esc(p.title)}</h1>${p.lines.map((l) => `<div class="d-px" style="font-size:12pt;margin-top:1.4mm">${kit.inline(l)}</div>`).join('')}</div></div>`;
  },

  section(s: Section, ctx) {
    if (s.title === '' && s.num === null) return `<section class="d-sec">${s.body}</section>`;
    const w = ctx.pageMm.w - 34;
    const mode = (['spiral', 'tunnel', 'ripple'] as const)[s.index % 3];
    return `<section class="d-sec"><div class="d-band"><svg class="lay-svg" viewBox="0 0 ${w} 38" preserveAspectRatio="none">${dream(w, 38, seedOf(s.titleText + s.index), `s${s.index}`, mode)}</svg>
${s.num ? `<span class="num d-tag" style="color:${C.white}">${s.num}</span>` : ''}<span class="key d-mono" style="font-weight:700">${ctx.kit.esc(snake(s.titleText))}</span>
<h1 class="d-px">${s.title}</h1></div>${s.body}</section>`;
  },

  gates(g: Gates) {
    const n = g.rows.length;
    // the gates as rings round one centre, the first innermost, each code set on its ring
    let rings = '', labels = '';
    for (let i = 0; i < n; i++) {
      const rad = 6 + (i + 1) * (24 / n);
      rings += `<circle cx="31" cy="31" r="${f(rad)}" fill="none" stroke="${ramp(0.3 + (i / Math.max(1, n - 1)) * 0.6)}" stroke-width="${i === n - 1 ? 0.9 : 0.45}"/>`;
      // each code where its ring crosses its own ray, the rays fanned round the centre
      const a = ((-90 + (i * 300) / Math.max(1, n)) * Math.PI) / 180;
      const tx = 31 + Math.cos(a) * rad, ty = 31 + Math.sin(a) * rad;
      labels += `<rect x="${f(tx - 3)}" y="${f(ty - 1.9)}" width="6" height="3.8" fill="${C.black}"/><text x="${f(tx)}" y="${f(ty + 0.9)}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="2.6" font-weight="700" fill="#FFFFFF">${g.rows[i]!.code}</text>`;
    }
    rings += `<circle cx="31" cy="31" r="1.6" fill="${C.coral}"/>` + labels;
    return `<div class="d-gates"><div><div class="d-mono" style="margin-bottom:3mm;text-transform:uppercase;letter-spacing:.06em">${g.head.join(' · ')}</div><div class="rings"><svg class="lay-svg" viewBox="0 0 62 62">${rings}</svg></div></div>
<div>${g.rows.map((r) => {
      const l = gateLines(g, r);
      return `<div class="row"><div class="code">${r.code}</div><div>${l.date ? `<div class="d-mono" style="color:${C.haze}">${l.date}</div>` : ''}${l.lead ? `<div style="font-weight:700;line-height:1.3">${l.lead}</div>` : ''}<div style="font-size:8pt;line-height:1.4;opacity:.85">${l.rest.join('<br>')}</div></div></div>`;
    }).join('')}</div></div>`;
  },

  end(p, ctx) {
    if (p.contacts.length === 0 && p.foot.length === 0) return '';
    const { kit } = ctx;
    return `<div class="d-end"><div class="box">${p.contacts.map((l, i) => `<div style="${i === 0 ? 'font-weight:700' : ''}">${kit.inline(l)}</div>`).join('')}</div>
<div class="box d-mono">${p.foot.map((l) => `<div>• ${kit.inline(l)}</div>`).join('')}</div></div>`;
  },

  footer(ctx, faces) {
    const ref = ctx.doc.meta.reference ?? '';
    return `<style>${faces}</style><div style="width:100%;box-sizing:border-box;padding:0 64px 26px;display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-size:6.4pt;letter-spacing:.06em;color:${ctx.theme.colors.ink}">
<span>${ctx.kit.esc(snake(ctx.doc.meta.title))}${ref ? ` · ${ctx.kit.esc(ref)}` : ''}</span><span>[ <span class="pageNumber"></span> / <span class="totalPages"></span> ]</span></div>`;
  },
};
