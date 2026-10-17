// A layout module (ADR 0011), as small as a layout can be: every hook, each
// printing what it was handed. A real one draws a cover, section openings
// and a running foot in its own language; see src/render/layouts/ for five.
// The type import is erased when the module runs.
import type { Layout, LayoutKit } from '../../src/render/layouts/api.js';

export const layoutApi = 1;

export default function (kit: LayoutKit): Layout {
  const index = (nums: (string | null)[], titles: string[]) =>
    titles.map((t, i) => `<li><b>${nums[i] ?? ''}</b><span>${t}</span></li>`).join('');
  return {
    css: () => '.ft-cover{ min-height: 100mm }',
    cover: (p, ctx) => `<section class="ft-cover"><h1>${ctx.kit.esc(p.title)}</h1><ol>${index(ctx.sectionNums, ctx.sectionTitles)}</ol></section>`,
    masthead: (p, ctx) => `<header class="ft-mast">${ctx.kit.esc(kit.plain([{ t: 'text', v: p.title }]))}</header>`,
    section: (s) => `<section class="ft-sec">${s.title === '' ? '' : `<h2>${s.title}</h2>`}${s.body}</section>`,
    gates: (g, ctx) => `<ol class="ft-gates">${g.rows.map((r) => `<li>${kit.gateLines(g, r).rest.map(ctx.kit.esc).join(' ')}</li>`).join('')}</ol>`,
    end: () => '',
    footer: () => '<span></span>',
  };
}
