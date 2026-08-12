import { describe, expect, it } from 'vitest';
import { ingestMarkdown } from '../../src/ingest/md.js';
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
});
