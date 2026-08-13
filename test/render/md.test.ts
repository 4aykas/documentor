import { describe, expect, it } from 'vitest';
import { ingestMarkdown } from '../../src/ingest/md.js';
import type { Doc } from '../../src/ir/types.js';
import { renderMarkdown } from '../../src/render/md.js';

const roundTrip = (md: string) => renderMarkdown(ingestMarkdown(md).doc);

describe('renderMarkdown', () => {
  it('writes the title as an h1 and the body after it', () => {
    expect(roundTrip('# Report\n\nHello.')).toBe('# Report\n\nHello.\n');
  });

  it('is idempotent — rendering its own output changes nothing', () => {
    const once = roundTrip('# T\n\n- a\n  - b\n\n| x | y |\n|:--|--:|\n| 1 | 2 |\n');
    expect(roundTrip(once)).toBe(once);
  });

  it('escapes pipes inside table cells so the table survives a round trip', () => {
    const out = roundTrip('# T\n\n| a |\n|---|\n| x \\| y |\n');
    expect(out).toContain('x \\| y');
    expect(roundTrip(out)).toBe(out);
  });

  it('indents a nested list by its depth', () => {
    expect(roundTrip('# T\n\n- one\n  - deeper\n')).toBe('# T\n\n- one\n  - deeper\n');
  });

  it('renders emphasis, code spans and links', () => {
    const md = '# T\n\nA **b** and `c` and [d](https://e.f).';
    expect(roundTrip(md)).toBe('# T\n\nA **b** and `c` and [d](https://e.f).\n');
  });

  it('renders quotes, fenced code and rules', () => {
    const md = '# T\n\n> quoted\n\n```js\nx\n```\n\n---\n';
    expect(roundTrip(md)).toBe('# T\n\n> quoted\n\n```js\nx\n```\n\n---\n');
  });

  it('splits a list around a nested sublist so reading order survives', () => {
    // Regression for fix round 1: the old ingester deferred a nested list to the
    // very end of its parent, so "two" printed before "deeper" even though
    // "deeper" came first in the source.
    const md = '# T\n\n- one\n  - deeper\n- two\n';
    expect(roundTrip(md)).toBe('# T\n\n- one\n  - deeper\n- two\n');
  });

  it('continues ordered numbering past a nested sublist instead of restarting at 1', () => {
    const out = roundTrip('# T\n\n1. a\n   - nested\n2. b\n');
    expect(out).toBe('# T\n\n1. a\n  - nested\n2. b\n');
    expect(out).not.toContain('\n1. b');
  });

  it('keeps a source list that starts at a number other than 1 through a round trip', () => {
    const md = '# T\n\n3. a\n4. b\n';
    expect(roundTrip(md)).toBe(md);
  });

  it('flattens two levels of nesting in source order', () => {
    const md = '# T\n\n- one\n  - two\n    - three\n';
    expect(roundTrip(md)).toBe(md);
  });

  it('collapses a literal newline inside a table cell to a space', () => {
    const doc: Doc = {
      meta: { title: 'T', lang: 'en' },
      blocks: [
        { t: 'table', head: [[{ t: 'text', v: 'a' }]], rows: [[[{ t: 'text', v: 'x\ny' }]]], align: ['l'] },
      ],
    };
    const out = renderMarkdown(doc);
    expect(out).toContain('x y');
    expect(out).not.toContain('x\ny');
    // And the escape holds up under a second pass, same as the pipe-escaping test above.
    expect(renderMarkdown(ingestMarkdown(out).doc)).toBe(out);
  });

  it('renders a fenced code block with no language, and one whose body holds a run of four backticks', () => {
    const noLang: Doc = { meta: { title: 'T', lang: 'en' }, blocks: [{ t: 'code', text: 'plain' }] };
    expect(renderMarkdown(noLang)).toBe('# T\n\n```\nplain\n```\n');

    const fourTicks: Doc = {
      meta: { title: 'T', lang: 'en' },
      blocks: [{ t: 'code', text: 'has ```` inside' }],
    };
    const out = renderMarkdown(fourTicks);
    // A fence must be longer than the longest backtick run it contains (here 4), so 5.
    expect(out).toBe('# T\n\n`````\nhas ```` inside\n`````\n');
    expect(renderMarkdown(ingestMarkdown(out).doc)).toBe(out);
  });
});

describe('heatmap in Markdown', () => {
  const doc = (style: 'fill' | 'scale' | 'numbers' | 'marks'): Doc => ({
    meta: { title: 'T', lang: 'en' },
    blocks: [{ t: 'heatmap', style, rows: [
      { label: 'Electrical', values: [16, 8, 0] },
      { label: 'BIM', values: [4, 4, 4] },
    ] }],
  });

  it('writes numbers (and scale) as an hours table with week headers', () => {
    const md = renderMarkdown(doc('numbers'));
    expect(md).toContain('| W01 | W02 | W03 |');
    expect(md).toContain('| Electrical | 16 | 8 |  |');
    expect(md).toContain('| BIM | 4 | 4 | 4 |');
  });

  it('writes marks as marks, stepped against the matrix maximum', () => {
    const md = renderMarkdown(doc('marks'));
    expect(md).toContain('| Electrical | ▪▪▪ | ▪▪ |  |');
  });

  it('writes fill as filled-or-empty', () => {
    const md = renderMarkdown(doc('fill'));
    expect(md).toContain('| Electrical | ■ | ■ |  |');
  });

  it('renders scale with no trailing prose — the matrix, nothing appended', () => {
    const md = renderMarkdown(doc('scale'));
    // The document ends with the last table row — no extra line explaining
    // the shading appended after it. That explanation is the template's to
    // write, not this renderer's.
    expect(md.trimEnd().endsWith('| BIM | 4 | 4 | 4 |')).toBe(true);
  });

  it('escapes a pipe inside a heatmap row label', () => {
    const withPipe: Doc = {
      meta: { title: 'T', lang: 'en' },
      blocks: [{ t: 'heatmap', style: 'numbers', rows: [
        { label: 'Mechanical | HVAC', values: [1, 2] },
      ] }],
    };
    const md = renderMarkdown(withPipe);
    expect(md).toContain('| Mechanical \\| HVAC | 1 | 2 |');
  });
});
