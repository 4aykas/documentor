import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBuild } from '../../src/cli/build.js';

// Shared with the vi.mock factory below via vi.hoisted — a plain module-level
// `let` would not be visible inside the factory, since vi.mock itself is
// hoisted above this import block. Everything not in `failForPaths` passes
// straight through to the real fs/promises, so every other test in this file
// (which all use real temp directories) is unaffected; only the one test
// that adds a path here sees a synthetic EACCES.
const { failForPaths } = vi.hoisted(() => ({ failForPaths: new Set<string>() }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readdir: (path: unknown, opts?: unknown) => {
      if (failForPaths.has(String(path))) {
        return Promise.reject(new Error(`EACCES: permission denied, scandir '${String(path)}'`));
      }
      return (actual.readdir as (p: unknown, o?: unknown) => Promise<unknown>)(path, opts);
    },
  };
});

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

  describe('a target collision between two sources', () => {
    it('refuses both sides, flat folder: report.docx and report.md both target report.plain.md', async () => {
      const dir = await tmp('documentor-batch-collide-flat-');
      const { renderDocx } = await import('../../src/render/docx.js');
      const { resolveTheme } = await import('../../src/theme/resolve.js');
      const theme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C', muted: '#898D8D', rule: '#CDCDCE' } });
      await writeFile(join(dir, 'report.md'), '# From Markdown\n\nHello.\n');
      await writeFile(
        join(dir, 'report.docx'),
        await renderDocx({ meta: { title: 'From Word', lang: 'en' }, blocks: [{ t: 'para', text: [{ t: 'text', v: 'Hi.' }] }] }, theme, { epochSeconds: 1_000_000_000 }),
      );
      const { io, log, err } = collect();

      expect(await runBuild([dir, '--to', 'md'], io)).toBe(3); // refused, nothing crashed
      // The critical property: no report.plain.md exists holding just one
      // source's content while the summary claims both were written. Only
      // the two originals are on disk — neither collision side wrote at all.
      expect((await readdir(dir)).sort()).toEqual(['report.docx', 'report.md']);
      const out = [...log, ...err].join('\n');
      expect(out).toMatch(/collides/);
      expect(out).toMatch(/report\.docx/);
      expect(out).toMatch(/report\.md/);
      // Never counted as a write that was later overwritten.
      expect(log.join('\n')).toMatch(/0 written/);
    });

    it('refuses both sides, recursive with --out: a/report.md and b/report.md both target <out>/report.plain.md', async () => {
      const dir = await tmp('documentor-batch-collide-rec-');
      const out = await tmp('documentor-batch-collide-out-');
      await mkdir(join(dir, 'a'));
      await mkdir(join(dir, 'b'));
      await writeFile(join(dir, 'a', 'report.md'), '# A\n\nContent A.\n');
      await writeFile(join(dir, 'b', 'report.md'), '# B\n\nContent B.\n');
      const { io, log, err } = collect();

      expect(await runBuild([dir, '--to', 'md', '--recursive', '--out', out], io)).toBe(3);
      // The natural-shape failure named in the review: without the fix this
      // left one file in <out> holding only B's content, reported as
      // "2 written". Now neither side is written at all.
      expect(await readdir(out)).toEqual([]);
      const outText = [...log, ...err].join('\n');
      expect(outText).toMatch(/collides/);
      expect(log.join('\n')).toMatch(/0 written/);
    });
  });

  it('launches no browser at all when nothing --to needs one', async () => {
    // A directory batch writing only md/docx has no PDF to render, so it
    // should carry no Chromium dependency — proven here by emptying
    // PLAYWRIGHT_BROWSERS_PATH so any real launch attempt fails loudly,
    // the same signal the review used ("with the browser cache emptied,
    // a directory --to md fails with playwright's install message").
    const dir = await tmp('documentor-batch-nobrowser-');
    await writeFile(join(dir, 'a.md'), '# A\n\nHello.\n');
    await writeFile(join(dir, 'b.docx'), '');
    const { io } = collect();
    const prev = process.env['PLAYWRIGHT_BROWSERS_PATH'];
    process.env['PLAYWRIGHT_BROWSERS_PATH'] = join(dir, 'no-such-browsers-here');
    try {
      // b.docx is bogus bytes, so it will fail — that's fine, this test only
      // cares that no PDF renderer, and therefore no browser launch, was
      // ever attempted for the whole batch.
      const code = await runBuild([dir, '--to', 'md,docx'], io);
      expect(code).toBe(1); // b.docx failed to ingest, as expected
      expect(await readdir(dir)).toEqual(expect.arrayContaining(['a.plain.md', 'a.plain.docx']));
    } finally {
      if (prev === undefined) delete process.env['PLAYWRIGHT_BROWSERS_PATH'];
      else process.env['PLAYWRIGHT_BROWSERS_PATH'] = prev;
    }
  });

  it('honours --out for --plain-names with --to md, since output no longer lands back in the scanned folder', async () => {
    const dir = await tmp('documentor-batch-plainok-in-');
    const out = await tmp('documentor-batch-plainok-out-');
    await writeFile(join(dir, 'report.md'), '# Report\n\nHello.\n');
    const { io, err } = collect();
    expect(await runBuild([dir, '--to', 'md', '--plain-names', '--out', out], io)).toBe(0);
    expect(err.join('\n')).not.toMatch(/--plain-names/);
    expect(await readdir(out)).toEqual(['report.md']);
  });

  it('reports a genuine source shadowed by the own-output filter, with a count, instead of silently dropping it', async () => {
    const dir = await tmp('documentor-batch-shadow-');
    await writeFile(join(dir, 'report.md'), '# Report\n\nHello.\n');
    // A real source that happens to be named like this build's own output —
    // stem ends ".plain", the current theme's id — is exactly what
    // discoverInputs' marker filter cannot tell apart from a prior run.
    await writeFile(join(dir, 'contract.plain.md'), '# Contract\n\nA real document.\n');
    const { io, log } = collect();
    expect(await runBuild([dir, '--to', 'md'], io)).toBe(0);
    const summary = log.join('\n');
    expect(summary).toMatch(/1 skipped as this build's own prior output/);
    expect(summary).toMatch(/contract\.plain\.md/);
  });

  it('does not let one unreadable subdirectory stop the batch, and reports it instead', async () => {
    const dir = await tmp('documentor-batch-baddir-');
    await writeFile(join(dir, 'good.md'), '# Good\n\nHello.\n');
    await mkdir(join(dir, 'locked'));
    await writeFile(join(dir, 'locked', 'hidden.md'), '# Hidden\n\nNever seen.\n');
    failForPaths.add(join(dir, 'locked'));
    const { io, log, err } = collect();

    try {
      expect(await runBuild([dir, '--to', 'md', '--recursive'], io)).toBe(1);
    } finally {
      failForPaths.clear();
    }
    expect(await readdir(dir)).toEqual(expect.arrayContaining(['good.plain.md']));
    const out = [...log, ...err].join('\n');
    expect(out).toMatch(/locked/);
    expect(out).toMatch(/could not be read/);
  });

  it('counts a partially-written document once, not as both written and refused, and names the output directory', async () => {
    // report.docx --to docx,md --plain-names --out <its own directory>:
    // the docx target collides with the input itself (same-extension
    // overwrite guard) and is refused, while the md target (a different
    // extension) writes normally — one document, two outcomes.
    const dir = await tmp('documentor-batch-partial-');
    const { renderDocx } = await import('../../src/render/docx.js');
    const { resolveTheme } = await import('../../src/theme/resolve.js');
    const theme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C', muted: '#898D8D', rule: '#CDCDCE' } });
    await writeFile(
      join(dir, 'report.docx'),
      await renderDocx({ meta: { title: 'T', lang: 'en' }, blocks: [{ t: 'para', text: [{ t: 'text', v: 'Hi.' }] }] }, theme, { epochSeconds: 1_000_000_000 }),
    );
    const { io, log } = collect();
    expect(await runBuild([dir, '--to', 'docx,md', '--plain-names', '--out', dir], io)).toBe(3);
    const summary = log.join('\n');
    expect(summary).toMatch(/0 written/);
    expect(summary).toMatch(/1 partially written/);
    expect(summary).toMatch(/wrote 1 file\(s\) to/);
    expect(await readdir(dir)).toEqual(['report.docx', 'report.md']);
  });
});
