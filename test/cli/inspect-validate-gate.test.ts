import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A whole file of its own for the same reason test/cli/validate-gate.test.ts
// is: vi.mock is hoisted to the top of the module it appears in, so it would
// mock the ingester out from under every other inspect test in this suite if
// it lived beside them.
vi.mock('../../src/ingest/md.js', () => ({
  ingestMarkdown: () => ({
    doc: {
      meta: { title: 'Report', lang: 'en' },
      // level 9 is not a heading level the IR has — validateDoc must refuse
      // this the same way it refuses build.
      blocks: [{ t: 'heading', level: 9, text: [{ t: 'text', v: 'Nope' }] }],
    },
    dropped: [],
  }),
}));

const { runInspect } = await import('../../src/cli/inspect.js');

describe('inspect: the validation gate between ingest and report', () => {
  it('reports "refused" and exits 3 for a document build would also refuse, without pretending to have understood it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-inspect-bad-'));
    const file = join(dir, 'report.md');
    await writeFile(file, '# Report\n');
    const log: string[] = [];
    const io = { log: (s: string) => log.push(s), err: () => {} };

    expect(await runInspect([file, '--json'], io)).toBe(3);
    const result = JSON.parse(log.join('\n')) as { documents: { status: string; reason?: string }[] };
    const doc = result.documents[0]!;
    expect(doc.status).toBe('refused');
    expect(doc.reason).toMatch(/blocks\[0\].*level must be 1, 2 or 3/);
  });

  it('says the same thing in the human form', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-inspect-bad-human-'));
    const file = join(dir, 'report.md');
    await writeFile(file, '# Report\n');
    const log: string[] = [];
    const io = { log: (s: string) => log.push(s), err: () => {} };

    expect(await runInspect([file], io)).toBe(3);
    expect(log.join('\n')).toMatch(/refused:.*level must be 1, 2 or 3/);
  });
});
