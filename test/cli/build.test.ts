import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Doc } from '../../src/ir/types.js';
import { renderDocx } from '../../src/render/docx.js';
import { resolveTheme } from '../../src/theme/resolve.js';
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

// A .docx fixture the CLI can read, built the same way test/ingest/docx.test.ts
// builds its round-trip fixture: rendered by this project's own renderer
// rather than committed as a binary nobody could diff.
const fixtureTheme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C', muted: '#898D8D', rule: '#CDCDCE' } });

async function docxFixture(doc: Doc, name = 'report.docx'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'documentor-cli-docx-'));
  const file = join(dir, name);
  const bytes = await renderDocx(doc, fixtureTheme, { epochSeconds: 1_000_000_000 });
  await writeFile(file, bytes);
  return file;
}

describe('parseArgs', () => {
  it('leaves to/theme/plainNames unset when not given — the defaults now live in config.ts\'s resolveConfig, the one place a flag, a sidecar, and a fallback are weighed together', () => {
    expect(parseArgs(['a.md'])).toEqual({ input: 'a.md', recursive: false, noConfig: false });
  });
  it('reads --plain-names', () => {
    expect(parseArgs(['a.md', '--plain-names']).plainNames).toBe(true);
  });
  it('splits --to on commas', () => {
    expect(parseArgs(['a.md', '--to', 'pdf, md']).to).toEqual(['pdf', 'md']);
  });
  it('rejects an unknown option', () => {
    expect(() => parseArgs(['a.md', '--colour'])).toThrow(/--colour/);
  });
  it('reads --date and --entity', () => {
    const args = parseArgs(['a.md', '--date', 'July 20, 2026', '--entity', 'Acme Sp. z o.o.']);
    expect(args.date).toBe('July 20, 2026');
    expect(args.entity).toBe('Acme Sp. z o.o.');
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

  it('names the output <stem>.<ext> under --plain-names, dropping the theme id', async () => {
    const file = await fixture('# Report\n\nHello.\n');
    const { io } = collect();
    expect(await runBuild([file, '--to', 'pdf', '--plain-names'], io)).toBe(0);
    const written = await readdir(join(file, '..'));
    expect(written.sort()).toEqual(['report.md', 'report.pdf']);
  });

  it('refuses a same-extension --plain-names build that would overwrite the input, and leaves the input untouched', async () => {
    const file = await fixture('# Report\n\nHello.\n');
    const before = await readFile(file, 'utf8');
    const { io, err } = collect();
    expect(await runBuild([file, '--to', 'md', '--plain-names'], io)).toBe(3);
    expect(err.join('\n')).toMatch(/refusing to overwrite/);
    const written = await readdir(join(file, '..'));
    expect(written).toEqual(['report.md']); // only the input — nothing else was written
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('when one of several --plain-names formats collides with the input, writes the others and refuses only that one', async () => {
    const file = await fixture('# Report\n\nHello.\n');
    const { io, err } = collect();
    expect(await runBuild([file, '--to', 'pdf,md', '--plain-names'], io)).toBe(3);
    expect(err.join('\n')).toMatch(/refusing to overwrite/);
    const written = await readdir(join(file, '..'));
    // pdf was written (no collision); md was refused (would overwrite report.md, the input)
    expect(written.sort()).toEqual(['report.md', 'report.pdf']);
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

  it('reads a .docx input and produces a PDF', async () => {
    const file = await docxFixture({ meta: { title: 'From the body', lang: 'en' }, blocks: [{ t: 'para', text: [{ t: 'text', v: 'Hello.' }] }] });
    const { io } = collect();
    expect(await runBuild([file, '--to', 'pdf'], io)).toBe(0);
    const written = await readdir(join(file, '..'));
    expect(written.sort()).toEqual(['report.docx', 'report.plain.pdf']);
  });

  it('titles a .docx from its filename when the body carries none, and lets --title override that', async () => {
    // renderDocx always writes a DocTitle paragraph, so an empty meta.title is
    // the only way to build a fixture whose body carries no title — the same
    // "nothing supplies a title" case ingestDocx's own test exercises, which
    // is exactly the case the CLI's filename fallback exists for.
    const file = await docxFixture({ meta: { title: '', lang: 'en' }, blocks: [{ t: 'para', text: [{ t: 'text', v: 'Body.' }] }] }, 'reply-4-2.docx');
    const out = await mkdtemp(join(tmpdir(), 'documentor-docx-title-'));
    const { io } = collect();

    expect(await runBuild([file, '--to', 'md', '--out', out], io)).toBe(0);
    expect((await readFile(join(out, 'reply-4-2.plain.md'), 'utf8')).split('\n')[0]).toBe('# reply-4-2');

    const { io: io2 } = collect();
    expect(await runBuild([file, '--to', 'md', '--out', out, '--title', 'Given Title'], io2)).toBe(0);
    expect((await readFile(join(out, 'reply-4-2.plain.md'), 'utf8')).split('\n')[0]).toBe('# Given Title');
  });

  it('lets --date override the date a .docx header carried', async () => {
    const file = await docxFixture({
      meta: { title: 'T', lang: 'en', date: 'July 20, 2026' },
      blocks: [{ t: 'para', text: [{ t: 'text', v: 'Body.' }] }],
    });
    const out = await mkdtemp(join(tmpdir(), 'documentor-docx-date-'));
    const { io } = collect();
    const { docxPart } = await import('../helpers/docx-parts.js');

    expect(await runBuild([file, '--to', 'docx', '--out', out, '--date', 'August 12, 2026'], io)).toBe(0);
    const header = await docxPart(await readFile(join(out, 'report.plain.docx')), 'word/header2.xml');
    expect(header).toContain('August 12, 2026');
    expect(header).not.toContain('July 20, 2026');
  });

  it('does not let a .docx rendered --to docx overwrite its own .docx input', async () => {
    const file = await docxFixture({ meta: { title: 'T', lang: 'en' }, blocks: [{ t: 'para', text: [{ t: 'text', v: 'Body.' }] }] });
    const { io } = collect();
    expect(await runBuild([file, '--to', 'docx'], io)).toBe(0);
    const written = await readdir(join(file, '..'));
    expect(written.sort()).toEqual(['report.docx', 'report.plain.docx']);
  });

  it('refuses an input extension it cannot read yet, naming what it does read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-x-'));
    const file = join(dir, 'a.xlsx');
    await writeFile(file, 'not really an xlsx');
    const { io, err } = collect();
    expect(await runBuild([file], io)).toBe(2);
    expect(err.join('\n')).toMatch(/\.md/);
    expect(err.join('\n')).toMatch(/\.docx/);
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

  it('carries --date and --entity all the way into the rendered document', async () => {
    // How meta.entity/meta.date print under the letterhead is already covered
    // by test/render/html.test.ts and test/render/docx.test.ts — this only
    // proves the CLI flags survive parseArgs and actually reach the renderer,
    // rather than being dropped somewhere between the two. docx is the
    // cheapest format here to inspect end-to-end, since its header lives in
    // an inspectable XML part.
    const { docxPart } = await import('../helpers/docx-parts.js');
    const file = await fixture('# Report\n\nHello.\n');
    const out = await mkdtemp(join(tmpdir(), 'documentor-meta-'));
    const { io } = collect();
    // The date is passed through verbatim — not a machine date — precisely so
    // a re-issued document can carry a value like this one, not ISO 8601.
    expect(await runBuild(
      [file, '--to', 'docx', '--out', out, '--date', 'July 20, 2026', '--entity', 'Acme Sp. z o.o.'],
      io,
    )).toBe(0);
    const bytes = await readFile(join(out, 'report.plain.docx'));
    const header = await docxPart(bytes, 'word/header2.xml');
    expect(header).toContain('July 20, 2026');
    expect(header).toContain('Acme Sp. z o.o.');
  });

  it('leaves meta exactly as it was before --date/--entity existed, when neither flag is passed', async () => {
    // The property under test: a document rendered with no new flags must be
    // byte-identical to how it rendered before --date/--entity existed. Proven
    // here by rendering the same fixture twice — once through the exact
    // pre-change code path (ingestMarkdown called with only a possible
    // `title`, the way build.ts called it before this change) and once
    // through today's runBuild with no --date/--entity — and comparing bytes,
    // rather than assuming an absent option behaves like an absent option.
    const md = '# Report\n\nHello, world.\n';
    const file = await fixture(md);
    const out = await mkdtemp(join(tmpdir(), 'documentor-identity-'));
    const { io } = collect();
    expect(await runBuild([file, '--to', 'pdf', '--out', out], io)).toBe(0);
    const afterChange = await readFile(join(out, 'report.plain.pdf'));

    const { ingestMarkdown } = await import('../../src/ingest/md.js');
    const { validateDoc } = await import('../../src/ir/validate.js');
    const { renderPdf } = await import('../../src/render/pdf.js');
    const { loadTheme } = await import('../../src/theme/resolve.js');
    const { resolveEpoch } = await import('../../src/cli/timestamp.js');
    const { doc } = ingestMarkdown(md, {}); // exactly the pre-change call shape
    validateDoc(doc);
    const theme = await loadTheme('plain');
    const epochSeconds = await resolveEpoch(process.env, file);
    const beforeChange = await renderPdf(doc, theme, { epochSeconds });

    expect(Buffer.compare(afterChange, beforeChange)).toBe(0);
  });

  it('leaves the default naming and bytes untouched by the --plain-names option existing', async () => {
    // Same property as the test above, but for --plain-names rather than
    // --date/--entity: an absent flag must behave exactly as it did before
    // the flag existed, not merely "look right". Proven by rendering the
    // same fixture through today's runBuild with no flag at all, and
    // separately through an explicit --plain-names=false-equivalent (the
    // theme-id naming, computed directly, bypassing the flag entirely), then
    // comparing both the file name produced and its bytes.
    const md = '# Report\n\nHello, world.\n';
    const file = await fixture(md);
    const outA = await mkdtemp(join(tmpdir(), 'documentor-default-a-'));
    const outB = await mkdtemp(join(tmpdir(), 'documentor-default-b-'));
    const { io: ioA } = collect();

    expect(await runBuild([file, '--to', 'pdf', '--out', outA], ioA)).toBe(0);
    const withoutFlag = await readFile(join(outA, 'report.plain.pdf'));

    const { ingestMarkdown } = await import('../../src/ingest/md.js');
    const { validateDoc } = await import('../../src/ir/validate.js');
    const { renderPdf } = await import('../../src/render/pdf.js');
    const { loadTheme } = await import('../../src/theme/resolve.js');
    const { resolveEpoch } = await import('../../src/cli/timestamp.js');
    const { writeFile: write } = await import('node:fs/promises');
    const { doc } = ingestMarkdown(md, {});
    validateDoc(doc);
    const theme = await loadTheme('plain');
    const epochSeconds = await resolveEpoch(process.env, file);
    const computedDirectly = await renderPdf(doc, theme, { epochSeconds });
    const referenceTarget = join(outB, `report.${theme.id}.pdf`);
    await write(referenceTarget, computedDirectly);

    expect(await readdir(outA)).toEqual(['report.plain.pdf']);
    expect(await readdir(outB)).toEqual(['report.plain.pdf']);
    expect(Buffer.compare(withoutFlag, computedDirectly)).toBe(0);
  });
});
