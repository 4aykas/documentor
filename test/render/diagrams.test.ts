import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import type { Block, Doc } from '../../src/ir/types.js';
import { diagramTokens, diagramVars, drawDiagrams, hasDiagrams, kindOf, leftToRight } from '../../src/render/diagrams.js';
import * as tint from '../../src/render/tint.js';
import { renderPdf } from '../../src/render/pdf.js';
import { renderDocx } from '../../src/render/docx.js';
import { renderMarkdown } from '../../src/render/md.js';
import { buildHtml } from '../../src/render/html.js';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { validateDoc } from '../../src/ir/validate.js';
import { loadTheme, resolveTheme } from '../../src/theme/resolve.js';
import { pdfText } from '../helpers/pdf-text.js';
import { docxEntries } from '../helpers/docx-parts.js';
import { resetPdfjsWorkerGlobal } from '../helpers/pdfjs-worker.js';

const EPOCH = 1_000_000_000;
const theme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C' } });

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); resetPdfjsWorkerGlobal(); });

const FLOW = 'flowchart LR\n  A[Discovery] --> B{Exposed?}\n  B -->|yes| C[Validate]\n  B -->|no| D[Monitor]';
const MIND = 'mindmap\n  root((Focus))\n    Websites\n    Cloud\n    Credentials';
const md = `# Diagrams\n\nBefore.\n\n\`\`\`mermaid\n${FLOW}\n\`\`\`\n\n\`\`\`mermaid\n${MIND}\n\`\`\`\n\n\`\`\`js\nconst x = 1;\n\`\`\`\n`;

const draw = (src: string, warn: string[] = []) =>
  drawDiagrams(ingestMarkdown(src).doc, theme, browser, (m) => warn.push(m));
const diagrams = (doc: Doc) => doc.blocks.filter((b): b is Extract<Block, { t: 'diagram' }> => b.t === 'diagram');

describe('drawDiagrams', () => {
  it('draws each mermaid fence and leaves every other block as it was', async () => {
    const doc = await draw(md);
    expect(hasDiagrams(ingestMarkdown(md).doc)).toBe(true);
    expect(doc.blocks.map((b) => b.t)).toEqual(['para', 'diagram', 'diagram', 'code']);
    const [flow, mind] = diagrams(doc);
    expect(flow!.source).toBe(FLOW);
    expect(mind!.source).toBe(MIND);
    expect(flow!.svg.startsWith('<svg')).toBe(true);
    expect(flow!.png.startsWith('data:image/png;base64,')).toBe(true);
    expect(() => validateDoc(doc)).not.toThrow();
  });

  it('sets labels as SVG text, not HTML in a foreignObject', async () => {
    const [flow] = diagrams(await draw(md));
    expect(flow!.svg).not.toContain('foreignObject');
    for (const word of ['Discovery', 'Exposed?', 'Validate', 'Monitor', 'yes', 'no']) expect(flow!.svg).toContain(`>${word}<`);
  });

  it('fits the text column: never wider than the page leaves room for', async () => {
    const wide = `\`\`\`mermaid\nflowchart LR\n${Array.from({ length: 14 }, (_, i) => `  N${i}[Step number ${i}] --> N${i + 1}[Step number ${i + 1}]`).join('\n')}\n\`\`\`\n`;
    const [d] = diagrams(await draw(wide));
    expect(d!.wPt).toBeLessThanOrEqual(595.28 - theme.page.marginPt * 2 + 0.01);
    expect(d!.hPt).toBeGreaterThan(0);
  });

  it('draws the same picture twice', async () => {
    const a = diagrams(await draw(md));
    const b = diagrams(await draw(md));
    expect(a.map((d) => d.svg)).toEqual(b.map((d) => d.svg));
  });

  it('draws no "today" line on a Gantt chart, which would put the wall clock in the document', async () => {
    // A task spanning today, so a marker would land inside the chart.
    const gantt = '```mermaid\ngantt\n  dateFormat YYYY-MM-DD\n  section A\n  Task :a1, 2020-01-01, 7300d\n```\n';
    const [d] = diagrams(await draw(gantt));
    expect(d!.svg).not.toMatch(/class="today"/);
  });

  it('fetches nothing from the network: every request goes to the reserved local origin', async () => {
    // Watch the page drawDiagrams opens for itself, every request it makes,
    // aborted or not. Mermaid's modules load from https://documentor.invalid,
    // which a route answers from node_modules (.invalid never resolves), so
    // that origin is the only one allowed to appear at all.
    const requests: string[] = [];
    const watched = {
      newPage: async (o: Parameters<Browser['newPage']>[0]) => {
        const p = await browser.newPage(o);
        p.on('request', (r) => { if (!/^(data|about):/.test(r.url())) requests.push(r.url()); });
        return p;
      },
    } as unknown as Browser;
    await drawDiagrams(ingestMarkdown(md).doc, theme, watched, () => {});
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter((u) => new URL(u).origin !== 'https://documentor.invalid')).toEqual([]);
  });

  it('lays a flowchart out with ELK when its source asks for it', async () => {
    const elk = '```mermaid\n---\nconfig:\n  layout: elk\n---\nflowchart LR\n  A[One] --> B[Two] --> C[Three]\n  C --> A\n```\n';
    const warn: string[] = [];
    const [d] = diagrams(await draw(elk, warn));
    expect(warn).toEqual([]);
    for (const w of ['One', 'Two', 'Three']) expect(d!.svg).toContain(`>${w}<`);
    // Mermaid falls back to dagre without a word when a layout is not
    // registered, so the proof ELK ran is a different drawing.
    const [plain] = diagrams(await draw('```mermaid\nflowchart LR\n  A[One] --> B[Two] --> C[Three]\n  C --> A\n```\n'));
    expect(d!.svg).not.toBe(plain!.svg);
  });

  it('keeps a fence Mermaid cannot parse as its source, and says so', async () => {
    const warn: string[] = [];
    const doc = await draw('```mermaid\nflowchart LR\n  A -->\n```\n', warn);
    expect(doc.blocks).toEqual([{ t: 'code', lang: 'mermaid', text: 'flowchart LR\n  A -->' }]);
    expect(warn.join('\n')).toMatch(/diagram 1 \(mermaid\) could not be drawn/);
  });

  it('returns a document with no fence unchanged', async () => {
    const doc = ingestMarkdown('# T\n\nplain\n').doc;
    expect(await drawDiagrams(doc, theme, browser, () => {})).toBe(doc);
  });
});

describe('every renderer places the drawn diagram', () => {
  it('PDF carries every label as text', async () => {
    const doc = await draw(md);
    const text = (await pdfText(await renderPdf(doc, theme, { epochSeconds: EPOCH, browser }))).join(' ');
    for (const word of ['Discovery', 'Exposed?', 'Validate', 'Monitor', 'Focus', 'Websites', 'Cloud', 'Credentials']) {
      expect(text).toContain(word);
    }
  });

  it('HTML caps each diagram at its drawn size, so a small one is not stretched to the column', async () => {
    const doc = await draw(md);
    const html = await buildHtml(doc, theme);
    for (const d of diagrams(doc)) expect(html).toContain(`<svg style="max-width: ${d.wPt}pt; max-height: ${d.hPt}pt"`);
  });

  it('Word embeds one picture per diagram', async () => {
    const doc = await draw(md);
    const media = (await docxEntries(await renderDocx(doc, theme, { epochSeconds: EPOCH }))).filter((n) => n.startsWith('word/media/') && !n.endsWith('/'));
    expect(media).toHaveLength(2);
  });

  it('Markdown writes the fence back, and it reads back as the same source', async () => {
    const doc = await draw(md);
    const again = ingestMarkdown(renderMarkdown(doc)).doc.blocks.filter((b) => b.t === 'code');
    expect(again).toEqual([
      { t: 'code', lang: 'mermaid', text: FLOW },
      { t: 'code', lang: 'mermaid', text: MIND },
      { t: 'code', lang: 'js', text: 'const x = 1;' },
    ]);
  });
});

describe('types Mermaid colours by itself', () => {
  it('names a source\'s type past frontmatter and comments, and none for frontmatter that never closes', () => {
    expect(kindOf('---\nconfig:\n  layout: elk\n---\n%% c\nflowchart LR\n  A-->B')).toBe('flowchart');
    expect(kindOf('sankey-beta\nA,B,1')).toBe('sankey-beta');
    expect(kindOf('---\nconfig:\n  layout: elk\nflowchart LR')).toBe('');
  });

  it('gives eight series that differ in lightness even when the brand is the ink', async () => {
    const { luminance } = tint;
    const series = diagramTokens(await loadTheme('plain')).series;
    expect(series).toHaveLength(8);
    for (let i = 0; i < series.length; i++) for (let j = 0; j < i; j++) {
      expect(Math.abs(luminance(series[i]!) - luminance(series[j]!))).toBeGreaterThanOrEqual(0.035);
    }
  });

  it('sankey nodes and links take the theme\'s series, not Tableau\'s', async () => {
    const [d] = diagrams(await draw('```mermaid\nsankey-beta\nA,B,4\nA,C,2\n```\n'));
    const fills = [...d!.svg.matchAll(/<rect[^>]*fill="([^"]+)"/g)].map((m) => m[1]!.toUpperCase());
    const series = diagramTokens(theme).series;
    expect(fills.length).toBeGreaterThan(0);
    for (const f of fills) expect(series).toContain(f);
  });

  it('journey actors take the theme\'s series, not Mermaid\'s green and cyan', async () => {
    const [d] = diagrams(await draw('```mermaid\njourney\n  section S\n    Task: 5: Ann, Bob\n```\n'));
    expect(d!.svg).not.toMatch(/#8FBC8F|#7CFC00|#00FFFF/i);
  });

  it('caps a pie at part of the column', async () => {
    const [d] = diagrams(await draw('```mermaid\npie\n  "A" : 3\n  "B" : 1\n```\n'));
    expect(d!.wPt).toBeLessThanOrEqual((595.28 - theme.page.marginPt * 2) * 0.6 + 0.01);
  });
});

describe('a left-to-right flow too wide for the column', () => {
  it('is turned top-down by its header line alone', () => {
    expect(leftToRight('flowchart LR\n  A --> B')).toBe('flowchart TD\n  A --> B');
    expect(leftToRight('---\nconfig:\n  layout: elk\n---\n%% note\ngraph RL;\n  A-->B')).toBe('---\nconfig:\n  layout: elk\n---\n%% note\ngraph TD;\n  A-->B');
    expect(leftToRight('flowchart TD\n  A --> B')).toBeNull();
    expect(leftToRight('timeline\n  title T\n  2026 : a')).toBe('timeline TD\n  title T\n  2026 : a');
    expect(leftToRight('timeline TD\n  2026 : a')).toBeNull();
    expect(leftToRight('sequenceDiagram\n  A->>B: hi')).toBeNull();
  });

  it('is drawn top-down when that prints its labels larger, and the build says so', async () => {
    const chain = Array.from({ length: 9 }, (_, i) => `  S${i}[Step number ${i}] --> S${i + 1}[Step number ${i + 1}]`).join('\n');
    const warn: string[] = [];
    const doc = await draw(`\`\`\`mermaid\nflowchart LR\n${chain}\n\`\`\`\n`, warn);
    const [d] = diagrams(doc);
    expect(d!.hPt).toBeGreaterThan(d!.wPt);
    expect(d!.source.startsWith('flowchart LR')).toBe(true);
    expect(warn.join('\n')).toMatch(/drawn top-down/);
  });
});

describe('diagramVars', () => {
  it('draws structure in ink mixed into the sheet and spends the brand on arrowheads and the first branch', () => {
    const v = diagramVars(theme);
    const t = diagramTokens(theme);
    expect(v['primaryColor']).toBe(t.surface);
    expect(v['primaryBorderColor']).toBe(t.stroke);
    expect(v['lineColor']).toBe(t.line);
    expect(v['arrowheadColor']).toBe('#DA291C');
    expect(v['primaryTextColor']).toBe(theme.colors.ink);
    expect(v['edgeLabelBackground']).toBe(theme.colors.paper);
    expect(v['cScale0']).toBe('#DA291C');
    // the quadrant point Mermaid would otherwise print as hsl(0, 0%, NaN%)
    expect(v['quadrantPointFill']).toBe('#DA291C');
  });

  it('keeps the grey system in order: a box is fainter than its outline, the outline than a line, a line than text', () => {
    const { luminance } = tint;
    const t = diagramTokens(theme);
    const order = [t.surface, t.stroke, t.line, t.textSec, theme.colors.ink].map(luminance);
    for (let i = 1; i < order.length; i++) expect(order[i]!).toBeLessThan(order[i - 1]!);
  });

  it('labels each branch fill in whichever of ink and white reads on it', () => {
    const v = diagramVars(resolveTheme({ id: 'd', colors: { brandOnLight: '#1A1A1A' } }));
    expect(v['cScaleLabel0']).toBe('#FFFFFF');
    expect(v['cScaleLabel3']).not.toBe('#FFFFFF');
  });
});

describe('validateDoc', () => {
  const base = { t: 'diagram', lang: 'mermaid', source: 'pie\n "a" : 1', svg: '<svg></svg>', png: 'data:image/png;base64,AA==', wPt: 10, hPt: 10 };
  const doc = (b: object) => ({ meta: { title: 'T', lang: 'en' }, blocks: [b] });
  it('accepts a complete diagram', () => expect(() => validateDoc(doc(base))).not.toThrow());
  it.each([
    ['lang', { lang: 'plantuml' }],
    ['source', { source: '' }],
    ['svg', { svg: '<div>' }],
    ['png', { png: 'data:image/jpeg;base64,AA==' }],
    ['wPt', { wPt: 0 }],
  ])('refuses a bad %s', (_, over) => expect(() => validateDoc(doc({ ...base, ...over }))).toThrow(/blocks\[0\]/));
});
