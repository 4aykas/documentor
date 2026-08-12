import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestMarkdown } from '../../src/ingest/md.js';
import { buildHtml } from '../../src/render/html.js';
import { loadTheme } from '../../src/theme/resolve.js';

// The brief's plain `new URL('.', import.meta.url).pathname` strips the
// leading slash off a Windows drive path but leaves the rest of the
// pathname percent-encoded, so a checkout under a directory whose path
// contains a space resolves to a literal "%20" in the filesystem path and
// every read below fails with ENOENT. fileURLToPath decodes correctly on
// every platform.
const HERE = fileURLToPath(new URL('.', import.meta.url));

let source: string;
beforeAll(async () => {
  source = await readFile(join(HERE, '..', 'fixtures', 'kitchen-sink.md'), 'utf8');
});

describe('the TEBIN theme', () => {
  // The byte comparison of page one against its committed PNG lives in
  // test/baseline/local-only-pixels.test.ts, not here — it cannot run in
  // CI (rasterisation differs across machines) while the markup assertions
  // below can and do.

  it('paints the logo by class, so the theme owns its colours', async () => {
    const theme = await loadTheme('tebin');
    const { doc } = ingestMarkdown(source);
    const html = await buildHtml(doc, theme);
    // The mark carries the classes and the stylesheet carries the rules; if
    // either half goes missing the logo prints solid black, which is SVG's
    // initial fill and reads at a glance as "the stylesheet did not load".
    expect(html).toContain('class="c-brand"');
    expect(html).toContain('.logo .c-brand{ fill: var(--brand); }');
    expect(html).toContain('--brand: #DA291C;');
  });

  it('prints the letterhead the entity actually uses', async () => {
    const theme = await loadTheme('tebin');
    const { doc } = ingestMarkdown(source);
    const html = await buildHtml(doc, theme);
    expect(html).toContain('TEBIN.PRO Sp. z o.o.');
    expect(html).toContain('NIP: 9552562516 | REGON: 521434962');
  });
});
