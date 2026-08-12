import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBuild } from '../../src/cli/build.js';

const collect = () => {
  const log: string[] = []; const err: string[] = [];
  return { io: { log: (s: string) => log.push(s), err: (s: string) => err.push(s) }, log, err };
};

async function tmp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe('directory input', () => {
  it('reads only the extensions an ingester actually handles, skipping the rest silently', async () => {
    const dir = await tmp('documentor-batch-mixed-');
    await writeFile(join(dir, 'report.md'), '# Report\n\nHello.\n');
    await writeFile(join(dir, 'notes.txt'), 'not a document this build reads');
    await writeFile(join(dir, 'ledger.xlsx'), 'pretend spreadsheet bytes');
    const { io, log } = collect();

    expect(await runBuild([dir, '--to', 'md'], io)).toBe(0);
    const written = await readdir(dir);
    expect(written.sort()).toEqual(['ledger.xlsx', 'notes.txt', 'report.md', 'report.plain.md']);
    // Nothing was said about the two files that were never inputs at all —
    // "skipped silently" means no per-file noise, not a quiet mention.
    expect(log.join('\n')).not.toMatch(/notes\.txt|ledger\.xlsx/);
  });

  it('stays at the top level by default, and descends only with --recursive', async () => {
    const dir = await tmp('documentor-batch-nested-');
    await writeFile(join(dir, 'top.md'), '# Top\n\nHello.\n');
    await mkdir(join(dir, 'sub'));
    await writeFile(join(dir, 'sub', 'nested.md'), '# Nested\n\nHello.\n');

    const { io: ioFlat } = collect();
    expect(await runBuild([dir, '--to', 'md'], ioFlat)).toBe(0);
    expect((await readdir(dir)).sort()).toEqual(['sub', 'top.md', 'top.plain.md']);
    expect(await readdir(join(dir, 'sub'))).toEqual(['nested.md']); // untouched

    const { io: ioRec } = collect();
    expect(await runBuild([dir, '--to', 'md', '--recursive'], ioRec)).toBe(0);
    expect((await readdir(join(dir, 'sub'))).sort()).toEqual(['nested.md', 'nested.plain.md']);
  });

  it('does not let one unreadable document stop the batch, and names it in the summary', async () => {
    const dir = await tmp('documentor-batch-bad-');
    await writeFile(join(dir, 'good.md'), '# Good\n\nHello.\n');
    // Not a real Word package — ingestDocx throws "not a Word document: ..."
    // for this, which is exactly the uncaught-throw case a lone build would
    // have surfaced as exit 1. The batch must catch it per-file instead.
    await writeFile(join(dir, 'broken.docx'), 'this is not a zip');
    const { io, log, err } = collect();

    expect(await runBuild([dir, '--to', 'md'], io)).toBe(1); // a failure outranks a clean batch
    expect(await readdir(dir)).toEqual(expect.arrayContaining(['good.plain.md']));
    const out = [...log, ...err].join('\n');
    expect(out).toMatch(/broken\.docx/);
    expect(out).toMatch(/zip file/i); // jszip's own message for bytes that aren't a Word package
  });

  it('reports what was dropped, grouped by kind rather than repeated per document', async () => {
    const dir = await tmp('documentor-batch-drop-');
    // Same dropped construct, same content, in two documents: the ingester's
    // dropped message carries the raw HTML text verbatim, so an *identical*
    // snippet is what collapses into one grouped line naming both files —
    // the exact case that would otherwise be the same message printed
    // twice, once per file, in a build that just concatenates every
    // document's own dropped list.
    await writeFile(join(dir, 'a.md'), '# A\n\n<div>raw</div>\n');
    await writeFile(join(dir, 'b.md'), '# B\n\n<div>raw</div>\n');
    await writeFile(join(dir, 'c.md'), '# C\n\nNothing dropped here.\n');
    const { io, log } = collect();

    expect(await runBuild([dir, '--to', 'md'], io)).toBe(0);
    const summary = log.join('\n');
    // One grouped line naming both documents, not one line per document.
    expect(summary).toMatch(/dropped:/i);
    expect(summary).toMatch(/a\.md.*b\.md|b\.md.*a\.md/);
    const dropLines = log.filter((l) => /block html/i.test(l));
    expect(dropLines.length).toBe(1);
  });

  it('says plainly when nothing was dropped', async () => {
    const dir = await tmp('documentor-batch-clean-');
    await writeFile(join(dir, 'a.md'), '# A\n\nHello.\n');
    const { io, log } = collect();
    expect(await runBuild([dir, '--to', 'md'], io)).toBe(0);
    expect(log.join('\n')).toMatch(/nothing dropped/);
  });

  it('does not ingest its own output on a second run over the same folder', async () => {
    const dir = await tmp('documentor-batch-rerun-');
    await writeFile(join(dir, 'report.md'), '# Report\n\nHello.\n');
    const { io: io1 } = collect();
    expect(await runBuild([dir, '--to', 'md'], io1)).toBe(0);
    expect((await readdir(dir)).sort()).toEqual(['report.md', 'report.plain.md']);

    const { io: io2, log: log2 } = collect();
    expect(await runBuild([dir, '--to', 'md'], io2)).toBe(0);
    // Still exactly these two files — report.plain.md was not re-ingested and
    // turned into e.g. report.plain.plain.md, and the summary counts one
    // document processed, not two.
    expect((await readdir(dir)).sort()).toEqual(['report.md', 'report.plain.md']);
    expect(log2.join('\n')).toMatch(/1 document\(s\)/);
  });

  it('refuses --plain-names with --to md/docx over a directory, since a rerun could not tell its own output apart', async () => {
    const dir = await tmp('documentor-batch-plainrisk-');
    await writeFile(join(dir, 'report.md'), '# Report\n\nHello.\n');
    const { io, err } = collect();
    expect(await runBuild([dir, '--to', 'md', '--plain-names'], io)).toBe(2);
    expect(err.join('\n')).toMatch(/--plain-names/);
  });

  it('exits 2 for a directory with nothing readable in it', async () => {
    const dir = await tmp('documentor-batch-empty-');
    await writeFile(join(dir, 'notes.txt'), 'nothing this build reads');
    const { io, err } = collect();
    expect(await runBuild([dir, '--to', 'md'], io)).toBe(2);
    expect(err.join('\n')).toMatch(/no readable input/);
  });

  it('single-file behaviour is unchanged when the input is a file, not a directory', async () => {
    // Same fixture and assertions as build.test.ts's own naming test, run
    // through the exact same runBuild entry point the directory branch now
    // forks out of first — proving the fork left this path untouched rather
    // than assuming it, since every existing caller depends on it.
    const dir = await tmp('documentor-batch-single-');
    const file = join(dir, 'report.md');
    await writeFile(file, '# Report\n\nHello.\n');
    const { io } = collect();
    expect(await runBuild([file, '--to', 'md'], io)).toBe(0);
    expect((await readdir(dir)).sort()).toEqual(['report.md', 'report.plain.md']);
  });
});
