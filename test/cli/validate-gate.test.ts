import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A whole file of its own because vi.mock is hoisted to the top of the module
// it appears in: the rest of the CLI suite needs the real ingester.
//
// Faking the ingester is the only honest way to reach this gate today — the
// Markdown ingester is exhaustive over what `marked` emits, so it cannot
// currently produce an invalid Doc. That is precisely why the gate is worth
// having: the ingesters, the sidecar overrides and any hand-written IR that
// arrive in later phases are not covered by that argument, and a renderer
// should not be the thing that discovers it.
vi.mock('../../src/ingest/md.js', () => ({
  ingestMarkdown: () => ({
    doc: {
      meta: { title: 'Report', lang: 'en' },
      // level 9 is not a heading level the IR has; TypeScript would catch it in
      // src/, a file read off disk would not.
      blocks: [{ t: 'heading', level: 9, text: [{ t: 'text', v: 'Nope' }] }],
    },
    dropped: [],
  }),
}));

const { runBuild } = await import('../../src/cli/build.js');

describe('the validation gate between ingest and render', () => {
  it('refuses a malformed document instead of rendering it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-bad-'));
    const file = join(dir, 'report.md');
    await writeFile(file, '# Report\n');
    const err: string[] = [];
    const io = { log: () => {}, err: (s: string) => err.push(s) };

    expect(await runBuild([file, '--to', 'md'], io)).toBe(3);
    // The message has to name the offending node, or the refusal is unactionable.
    expect(err.join('\n')).toMatch(/blocks\[0\].*level must be 1, 2 or 3/);
    // Nothing was drawn: the gate sits before the renderers, not after them.
    expect(await readdir(dir)).toEqual(['report.md']);
  });
});
