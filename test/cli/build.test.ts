import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FORMATS, parseArgs, runBuild } from '../../src/cli/build.js';

const collect = () => {
  const log: string[] = []; const err: string[] = [];
  return { io: { log: (s: string) => log.push(s), err: (s: string) => err.push(s) }, log, err };
};

async function fixture(md: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'documentor-cli-'));
  const file = join(dir, 'report.md');
  await writeFile(file, md);
  return file;
}

describe('parseArgs', () => {
  it('defaults to pdf and the plain theme', () => {
    expect(parseArgs(['a.md'])).toEqual({ input: 'a.md', to: ['pdf'], theme: 'plain' });
  });
  it('splits --to on commas', () => {
    expect(parseArgs(['a.md', '--to', 'pdf, md']).to).toEqual(['pdf', 'md']);
  });
  it('rejects an unknown option', () => {
    expect(() => parseArgs(['a.md', '--colour'])).toThrow(/--colour/);
  });
});

describe('runBuild', () => {
  it('writes the output beside the input, named after the theme', async () => {
    const file = await fixture('# Report\n\nHello.\n');
    const { io } = collect();
    expect(await runBuild([file, '--to', 'md'], io)).toBe(0);
    const written = await readdir(join(file, '..'));
    expect(written.sort()).toEqual(['report.md', 'report.plain.md']);
  });

  it('honours --out', async () => {
    const file = await fixture('# Report\n\nHello.\n');
    const out = await mkdtemp(join(tmpdir(), 'documentor-out-'));
    const { io } = collect();
    expect(await runBuild([file, '--to', 'md', '--out', out], io)).toBe(0);
    expect(await readdir(out)).toEqual(['report.plain.md']);
  });

  it('reports what the ingester had to leave out', async () => {
    const file = await fixture('# Report\n\n<div>raw</div>\n');
    const { io, err } = collect();
    await runBuild([file, '--to', 'md'], io);
    expect(err.join('\n')).toMatch(/html/i);
  });

  it('refuses a format it cannot write yet, naming the ones it can', async () => {
    const file = await fixture('# R\n');
    const { io, err } = collect();
    expect(await runBuild([file, '--to', 'xlsx'], io)).toBe(2);
    expect(err.join('\n')).toMatch(/pdf, md, docx/);
  });

  it('writes a Word document, named for the theme', async () => {
    const file = await fixture('# Report\n\nHello.\n');
    const { io } = collect();
    expect(await runBuild([file, '--to', 'docx'], io)).toBe(0);
    const written = await readdir(join(file, '..'));
    expect(written.sort()).toEqual(['report.md', 'report.plain.docx']);
  });

  it('produces identical Word bytes on two runs', async () => {
    const file = await fixture('# Report\n\nHello, [a link](https://example.com).\n');
    const a = await mkdtemp(join(tmpdir(), 'documentor-docx-a-'));
    const b = await mkdtemp(join(tmpdir(), 'documentor-docx-b-'));
    const { io } = collect();
    await runBuild([file, '--to', 'docx', '--out', a], io);
    await runBuild([file, '--to', 'docx', '--out', b], io);
    const [first, second] = await Promise.all([
      readFile(join(a, 'report.plain.docx')),
      readFile(join(b, 'report.plain.docx')),
    ]);
    expect(Buffer.compare(first, second)).toBe(0);
  });

  it('writes every format in its own bytes, never Markdown under another extension', async () => {
    // The real fix for the dispatch is compile-time: renderTo's `never` binding
    // makes a format without a branch a build error, which no runtime test can
    // observe. This pins the half that is observable — that each format FORMATS
    // admits produces something that is not simply the Markdown rendering,
    // which is what the old `?:` chain's tail branch would have written. It
    // iterates FORMATS rather than a list of its own, so a format added without
    // a renderer fails here too, on whichever machine runs the tests before
    // anyone runs the typechecker.
    const file = await fixture('# Report\n\nHello.\n');
    const out = await mkdtemp(join(tmpdir(), 'documentor-formats-'));
    const { io } = collect();
    expect(await runBuild([file, '--to', [...FORMATS].join(','), '--out', out], io)).toBe(0);
    const markdown = await readFile(join(out, 'report.plain.md'));
    for (const format of FORMATS) {
      const bytes = await readFile(join(out, `report.plain.${format}`));
      if (format === 'md') continue;
      expect(bytes.equals(markdown), `${format} was written as Markdown bytes`).toBe(false);
    }
  });

  it('refuses an input extension it cannot read yet', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-x-'));
    const file = join(dir, 'a.docx');
    await writeFile(file, 'not really a docx');
    const { io, err } = collect();
    expect(await runBuild([file], io)).toBe(2);
    expect(err.join('\n')).toMatch(/\.md/);
  });

  it('produces identical bytes on two runs', async () => {
    const file = await fixture('# Report\n\nHello.\n');
    const { io } = collect();
    await runBuild([file, '--to', 'pdf'], io);
    const first = await readFile(join(file, '..', 'report.plain.pdf'));
    await new Promise((r) => setTimeout(r, 1100));
    await runBuild([file, '--to', 'pdf'], io);
    const second = await readFile(join(file, '..', 'report.plain.pdf'));
    expect(Buffer.compare(first, second)).toBe(0);
  });
});
