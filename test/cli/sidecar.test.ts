import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Doc } from '../../src/ir/types.js';
import { renderDocx } from '../../src/render/docx.js';
import { resolveTheme } from '../../src/theme/resolve.js';
import { parseArgs, runBuild } from '../../src/cli/build.js';
import { parseInspectArgs, runInspect, type InspectResult } from '../../src/cli/inspect.js';
import { readSidecar, sidecarPathFor } from '../../src/cli/sidecar.js';
import { resolveConfig } from '../../src/cli/config.js';

const collect = () => {
  const log: string[] = []; const err: string[] = [];
  return { io: { log: (s: string) => log.push(s), err: (s: string) => err.push(s) }, log, err };
};

async function fixture(md: string, name = 'report.md'): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'documentor-sidecar-'));
  const file = join(dir, name);
  await writeFile(file, md);
  return { dir, file };
}

async function sidecarFor(file: string, data: unknown): Promise<string> {
  const path = sidecarPathFor(file);
  await writeFile(path, JSON.stringify(data));
  return path;
}

const fixtureTheme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C', muted: '#898D8D', rule: '#CDCDCE' } });

async function docxFixture(doc: Doc, name = 'report.docx'): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'documentor-sidecar-docx-'));
  const file = join(dir, name);
  const bytes = await renderDocx(doc, fixtureTheme, { epochSeconds: 1_000_000_000 });
  await writeFile(file, bytes);
  return { dir, file };
}

describe('parseArgs / parseInspectArgs: --config and --no-config', () => {
  it('build reads --config and --no-config', () => {
    expect(parseArgs(['a.md', '--config', 'x.documentor.json']).config).toBe('x.documentor.json');
    expect(parseArgs(['a.md', '--no-config']).noConfig).toBe(true);
  });
  it('inspect reads --config and --no-config, spelled exactly like build\'s own flags', () => {
    expect(parseInspectArgs(['a.md', '--config', 'x.documentor.json']).config).toBe('x.documentor.json');
    expect(parseInspectArgs(['a.md', '--no-config']).noConfig).toBe(true);
  });
  it('refuses --config and --no-config together, in both commands', () => {
    expect(() => parseArgs(['a.md', '--config', 'x.json', '--no-config'])).toThrow(/--config and --no-config/);
    expect(() => parseInspectArgs(['a.md', '--config', 'x.json', '--no-config'])).toThrow(/--config and --no-config/);
  });
});

describe('sidecar.ts: readSidecar', () => {
  it('refuses malformed JSON, naming the file', async () => {
    const { file } = await fixture('# Report\n');
    const path = sidecarPathFor(file);
    await writeFile(path, '{ not json');
    let message = '';
    try {
      await readSidecar(path);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain(path);
    expect(message).toMatch(/is not valid JSON/);
  });

  it('refuses an unknown key, naming it', async () => {
    const { file } = await fixture('# Report\n');
    const path = await sidecarFor(file, { title: 'Q3 Review', tittle: 'typo' });
    await expect(readSidecar(path)).rejects.toThrow(/unknown key "tittle"/);
  });

  it('refuses a field of the wrong type, naming the field and what it must be', async () => {
    const { file } = await fixture('# Report\n');
    const path = await sidecarFor(file, { to: 'pdf' }); // must be an array of strings
    await expect(readSidecar(path)).rejects.toThrow(/"to" must be an array of strings/);
  });

  it('accepts a sidecar holding only one field', async () => {
    const { file } = await fixture('# Report\n');
    const path = await sidecarFor(file, { theme: 'tebin' });
    expect(await readSidecar(path)).toEqual({ theme: 'tebin' });
  });
});

describe('config.ts: resolveConfig — --config with a directory input', () => {
  it('build refuses --config against a directory, explaining why', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-sidecar-dir-'));
    await writeFile(join(dir, 'a.md'), '# A\n\nHello.\n');
    const sidecar = join(dir, 'shared.documentor.json');
    await writeFile(sidecar, JSON.stringify({ theme: 'tebin' }));
    const { io, err } = collect();
    expect(await runBuild([dir, '--to', 'md', '--config', sidecar], io)).toBe(2);
    expect(err.join('\n')).toMatch(/--config names one sidecar file/);
    expect(err.join('\n')).toMatch(/directory/);
  });

  it('inspect refuses --config against a directory the same way', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-sidecar-dir-insp-'));
    await writeFile(join(dir, 'a.md'), '# A\n\nHello.\n');
    const sidecar = join(dir, 'shared.documentor.json');
    await writeFile(sidecar, JSON.stringify({ theme: 'tebin' }));
    const { io, err } = collect();
    expect(await runInspect([dir, '--config', sidecar], io)).toBe(2);
    expect(err.join('\n')).toMatch(/--config names one sidecar file/);
  });
});

describe('discovery: automatic, --config, --no-config', () => {
  it('discovers <stem>.documentor.json beside the input automatically and names it in the output', async () => {
    const { file } = await fixture('# Report\n\nHello.\n');
    await sidecarFor(file, { theme: 'tebin' });
    const { io, log } = collect();
    expect(await runBuild([file, '--to', 'md'], io)).toBe(0);
    expect(log.join('\n')).toMatch(/using report\.documentor\.json/);
    const written = await readdir(join(file, '..'));
    // tebin, not plain — the sidecar's theme id shows up in the output name.
    expect(written.sort()).toEqual(['report.documentor.json', 'report.md', 'report.tebin.md']);
  });

  it('--no-config ignores a sidecar that would otherwise apply, producing what the run would have produced without it', async () => {
    const { file } = await fixture('# Report\n\nHello.\n');
    await sidecarFor(file, { theme: 'tebin' });
    const { io, log } = collect();
    expect(await runBuild([file, '--to', 'md', '--no-config'], io)).toBe(0);
    expect(log.join('\n')).not.toMatch(/using /);
    const written = await readdir(join(file, '..'));
    expect(written.sort()).toEqual(['report.documentor.json', 'report.md', 'report.plain.md']);
  });

  it('--config names an explicit file, elsewhere on disk, instead of the one beside the input', async () => {
    const { file } = await fixture('# Report\n\nHello.\n');
    const elsewhere = await mkdtemp(join(tmpdir(), 'documentor-sidecar-elsewhere-'));
    const explicit = join(elsewhere, 'custom.json');
    await writeFile(explicit, JSON.stringify({ theme: 'tebin' }));
    const { io, log } = collect();
    expect(await runBuild([file, '--to', 'md', '--config', explicit], io)).toBe(0);
    expect(log.join('\n')).toMatch(/using custom\.json/);
    const written = await readdir(join(file, '..'));
    expect(written.sort()).toEqual(['report.md', 'report.tebin.md']);
  });

  it('a missing --config file is refused, naming the path', async () => {
    const { file } = await fixture('# Report\n\nHello.\n');
    const missing = join(await mkdtemp(join(tmpdir(), 'documentor-sidecar-missing-')), 'nope.json');
    const { io, err } = collect();
    expect(await runBuild([file, '--to', 'md', '--config', missing], io)).toBe(2);
    expect(err.join('\n')).toContain(missing);
  });

  it('no sidecar beside the input is not an error — the run proceeds as if none exists', async () => {
    const { file } = await fixture('# Report\n\nHello.\n');
    const { io, log } = collect();
    expect(await runBuild([file, '--to', 'md'], io)).toBe(0);
    expect(log.join('\n')).not.toMatch(/using /);
  });
});

describe('precedence: --flag > sidecar > the document\'s own metadata', () => {
  it('title: sidecar wins over the document\'s own h1 when no flag is given', async () => {
    const { file } = await fixture('# From The Body\n\nHello.\n');
    await sidecarFor(file, { title: 'From The Sidecar' });
    const out = await mkdtemp(join(tmpdir(), 'documentor-sidecar-title-'));
    const { io } = collect();
    expect(await runBuild([file, '--to', 'md', '--out', out], io)).toBe(0);
    const text = await readFile(join(out, 'report.plain.md'), 'utf8');
    expect(text.split('\n')[0]).toBe('# From The Sidecar');
  });

  it('title: an explicit --title wins over the sidecar\'s own title', async () => {
    const { file } = await fixture('# From The Body\n\nHello.\n');
    await sidecarFor(file, { title: 'From The Sidecar' });
    const out = await mkdtemp(join(tmpdir(), 'documentor-sidecar-title2-'));
    const { io } = collect();
    expect(await runBuild([file, '--to', 'md', '--out', out, '--title', 'From The Flag'], io)).toBe(0);
    const text = await readFile(join(out, 'report.plain.md'), 'utf8');
    expect(text.split('\n')[0]).toBe('# From The Flag');
  });

  it('title: with no flag and no sidecar, the document\'s own h1 still wins (absence of both)', async () => {
    const { file } = await fixture('# From The Body\n\nHello.\n');
    const out = await mkdtemp(join(tmpdir(), 'documentor-sidecar-title3-'));
    const { io } = collect();
    expect(await runBuild([file, '--to', 'md', '--out', out], io)).toBe(0);
    const text = await readFile(join(out, 'report.plain.md'), 'utf8');
    expect(text.split('\n')[0]).toBe('# From The Body');
  });

  it('entity: has no document source at all — the sidecar alone supplies it, and a flag overrides the sidecar', async () => {
    const { file } = await fixture('# Report\n\nHello.\n');
    await sidecarFor(file, { entity: 'From Sidecar Sp. z o.o.' });
    const { docxPart } = await import('../helpers/docx-parts.js');

    const out1 = await mkdtemp(join(tmpdir(), 'documentor-sidecar-entity1-'));
    const { io: io1 } = collect();
    expect(await runBuild([file, '--to', 'docx', '--out', out1], io1)).toBe(0);
    const header1 = await docxPart(await readFile(join(out1, 'report.plain.docx')), 'word/header2.xml');
    expect(header1).toContain('From Sidecar Sp. z o.o.');

    const out2 = await mkdtemp(join(tmpdir(), 'documentor-sidecar-entity2-'));
    const { io: io2 } = collect();
    expect(await runBuild([file, '--to', 'docx', '--out', out2, '--entity', 'From Flag Sp. z o.o.'], io2)).toBe(0);
    const header2 = await docxPart(await readFile(join(out2, 'report.plain.docx')), 'word/header2.xml');
    expect(header2).toContain('From Flag Sp. z o.o.');
    expect(header2).not.toContain('From Sidecar Sp. z o.o.');
  });

  it('date: the sidecar overrides what the document\'s own header carried, and a flag overrides the sidecar', async () => {
    const { file } = await docxFixture({
      meta: { title: 'T', lang: 'en', date: 'July 20, 2026' },
      blocks: [{ t: 'para', text: [{ t: 'text', v: 'Body.' }] }],
    });
    await sidecarFor(file, { date: 'From Sidecar, 2026' });
    const { docxPart } = await import('../helpers/docx-parts.js');

    const out1 = await mkdtemp(join(tmpdir(), 'documentor-sidecar-date1-'));
    const { io: io1 } = collect();
    expect(await runBuild([file, '--to', 'docx', '--out', out1], io1)).toBe(0);
    const header1 = await docxPart(await readFile(join(out1, 'report.plain.docx')), 'word/header2.xml');
    expect(header1).toContain('From Sidecar, 2026');
    expect(header1).not.toContain('July 20, 2026');

    const out2 = await mkdtemp(join(tmpdir(), 'documentor-sidecar-date2-'));
    const { io: io2 } = collect();
    expect(await runBuild([file, '--to', 'docx', '--out', out2, '--date', 'From Flag, 2026'], io2)).toBe(0);
    const header2 = await docxPart(await readFile(join(out2, 'report.plain.docx')), 'word/header2.xml');
    expect(header2).toContain('From Flag, 2026');
  });

  it('subtitle: has no CLI flag at all — the sidecar overrides the document\'s own DocSubtitle', async () => {
    const { file } = await docxFixture({
      meta: { title: 'T', subtitle: 'From The Body', lang: 'en' },
      blocks: [{ t: 'para', text: [{ t: 'text', v: 'Body.' }] }],
    });
    await sidecarFor(file, { subtitle: 'From The Sidecar' });
    const { io, log } = collect();
    expect(await runInspect([file], io)).toBe(0);
    expect(log.join('\n')).toMatch(/subtitle "From The Sidecar"/);
    expect(log.join('\n')).not.toMatch(/From The Body/);
  });

  it('theme: the sidecar\'s theme applies when no --theme is given, and --theme overrides it', async () => {
    const { file } = await fixture('# Report\n\nHello.\n');
    await sidecarFor(file, { theme: 'tebin' });

    const { io: io1 } = collect();
    expect(await runBuild([file, '--to', 'md'], io1)).toBe(0);
    expect(await readdir(join(file, '..'))).toEqual(expect.arrayContaining(['report.tebin.md']));

    const { file: file2 } = await fixture('# Report\n\nHello.\n', 'report2.md');
    await sidecarFor(file2, { theme: 'tebin' });
    const { io: io2 } = collect();
    expect(await runBuild([file2, '--to', 'md', '--theme', 'plain'], io2)).toBe(0);
    expect(await readdir(join(file2, '..'))).toEqual(expect.arrayContaining(['report2.plain.md']));
  });

  it('to: the sidecar\'s formats apply when no --to is given, and --to overrides it', async () => {
    const { file } = await fixture('# Report\n\nHello.\n');
    await sidecarFor(file, { to: ['md'] });
    const { io } = collect();
    // No --to at all: the sidecar's own `to` list is used instead of the
    // CLI default (['pdf']).
    expect(await runBuild([file], io)).toBe(0);
    const written = await readdir(join(file, '..'));
    expect(written).not.toEqual(expect.arrayContaining(['report.plain.pdf']));
    expect(written).toEqual(expect.arrayContaining(['report.plain.md']));
  });

  it('plainNames: the sidecar\'s plainNames applies when the flag is absent', async () => {
    const { file } = await fixture('# Report\n\nHello.\n');
    await sidecarFor(file, { plainNames: true });
    const { io } = collect();
    expect(await runBuild([file, '--to', 'pdf'], io)).toBe(0);
    const written = await readdir(join(file, '..'));
    expect(written).toEqual(expect.arrayContaining(['report.pdf'])); // not report.plain.pdf
  });
});

describe('inspect reads the sidecar too, and by the same rules', () => {
  it('reports the same resolved title/entity/theme --json as build would use, and names the sidecar used', async () => {
    const { file } = await fixture('# From The Body\n\nHello.\n');
    await sidecarFor(file, { title: 'From The Sidecar', entity: 'Acme Sp. z o.o.', theme: 'tebin' });
    const { io, log } = collect();
    expect(await runInspect([file, '--json'], io)).toBe(0);
    const result = JSON.parse(log.join('\n')) as InspectResult;
    const doc = result.documents[0]!;
    expect(doc.status).toBe('ok');
    if (doc.status !== 'ok') throw new Error('unreachable');
    expect(doc.title).toBe('From The Sidecar');
    expect(doc.entity).toBe('Acme Sp. z o.o.');
    expect(doc.config).toBe('report.documentor.json');
    expect(result.theme).toBe('tebin');
  });

  it('names the sidecar in the human form too', async () => {
    const { file } = await fixture('# Report\n\nHello.\n');
    await sidecarFor(file, { theme: 'tebin' });
    const { io, log } = collect();
    expect(await runInspect([file], io)).toBe(0);
    expect(log.join('\n')).toMatch(/config:\s+report\.documentor\.json/);
  });
});

describe('refusals: an unknown key or malformed JSON is a usage error, exit 2', () => {
  it('build refuses an unknown key, naming it, and exits 2', async () => {
    const { file } = await fixture('# Report\n\nHello.\n');
    await sidecarFor(file, { title: 'X', tittle: 'typo' });
    const { io, err } = collect();
    expect(await runBuild([file, '--to', 'md'], io)).toBe(2);
    expect(err.join('\n')).toMatch(/unknown key "tittle"/);
    // Nothing was written — the sidecar's unknown key must not silently do
    // nothing, per the design's own rule.
    expect(await readdir(join(file, '..'))).toEqual(['report.documentor.json', 'report.md']);
  });

  it('build refuses malformed JSON, naming the file, and exits 2', async () => {
    const { file } = await fixture('# Report\n\nHello.\n');
    await writeFile(sidecarPathFor(file), '{ this is not json');
    const { io, err } = collect();
    expect(await runBuild([file, '--to', 'md'], io)).toBe(2);
    expect(err.join('\n')).toMatch(/is not valid JSON/);
  });

  it('inspect refuses the same sidecar the same way, for a single file', async () => {
    const { file } = await fixture('# Report\n\nHello.\n');
    await sidecarFor(file, { tittle: 'typo' });
    const { io, err } = collect();
    expect(await runInspect([file], io)).toBe(2);
    expect(err.join('\n')).toMatch(/unknown key "tittle"/);
  });
});

describe('the batch path', () => {
  it('each input discovers its own sidecar, and the summary counts how many had one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-sidecar-batch-'));
    await writeFile(join(dir, 'a.md'), '# A\n\nHello.\n');
    await writeFile(join(dir, 'b.md'), '# B\n\nHello.\n');
    await writeFile(join(dir, 'a.documentor.json'), JSON.stringify({ theme: 'tebin' }));
    const { io, log } = collect();
    expect(await runBuild([dir, '--to', 'md'], io)).toBe(0);
    const summary = log.join('\n');
    expect(summary).toMatch(/1 had a sidecar/);
    const written = await readdir(dir);
    expect(written).toEqual(expect.arrayContaining(['a.tebin.md', 'b.plain.md']));
  });

  it('--no-config skips every sidecar in the batch, and the summary counts zero', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-sidecar-batch-noconf-'));
    await writeFile(join(dir, 'a.md'), '# A\n\nHello.\n');
    await writeFile(join(dir, 'a.documentor.json'), JSON.stringify({ theme: 'tebin' }));
    const { io, log } = collect();
    expect(await runBuild([dir, '--to', 'md', '--no-config'], io)).toBe(0);
    expect(log.join('\n')).toMatch(/0 had a sidecar/);
    expect(await readdir(dir)).toEqual(expect.arrayContaining(['a.plain.md']));
  });

  it('one file\'s malformed sidecar fails only that file — the rest of the batch still writes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-sidecar-batch-bad-'));
    await writeFile(join(dir, 'good.md'), '# Good\n\nHello.\n');
    await writeFile(join(dir, 'bad.md'), '# Bad\n\nHello.\n');
    await writeFile(join(dir, 'bad.documentor.json'), '{ not json');
    const { io, log, err } = collect();
    expect(await runBuild([dir, '--to', 'md'], io)).toBe(1); // a failure outranks a clean batch
    const out = [...log, ...err].join('\n');
    expect(out).toMatch(/bad\.md/);
    expect(out).toMatch(/not valid JSON/);
    expect(await readdir(dir)).toEqual(expect.arrayContaining(['good.plain.md']));
  });

  it('inspect\'s batch also counts and folds a bad sidecar into a per-document failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-sidecar-batch-insp-'));
    await writeFile(join(dir, 'good.md'), '# Good\n\nHello.\n');
    await writeFile(join(dir, 'good.documentor.json'), JSON.stringify({ entity: 'Acme' }));
    await writeFile(join(dir, 'bad.md'), '# Bad\n\nHello.\n');
    await writeFile(join(dir, 'bad.documentor.json'), '{ not json');
    const { io, log } = collect();
    expect(await runInspect([dir, '--json'], io)).toBe(1);
    const result = JSON.parse(log.join('\n')) as InspectResult;
    const good = result.documents.find((d) => d.file.endsWith('good.md'))!;
    const bad = result.documents.find((d) => d.file.endsWith('bad.md'))!;
    expect(good.status).toBe('ok');
    expect(bad.status).toBe('failed');
  });
});

describe('byte identity through the sidecar path', () => {
  it('the same input and the same sidecar, twice, produce byte-identical output', async () => {
    const { file } = await fixture('# Report\n\nHello, sidecar.\n');
    await sidecarFor(file, { title: 'Q3 Review', theme: 'tebin', entity: 'Acme Sp. z o.o.' });
    const outA = await mkdtemp(join(tmpdir(), 'documentor-sidecar-identity-a-'));
    const outB = await mkdtemp(join(tmpdir(), 'documentor-sidecar-identity-b-'));
    const { io: ioA } = collect();
    const { io: ioB } = collect();
    expect(await runBuild([file, '--to', 'docx', '--out', outA], ioA)).toBe(0);
    expect(await runBuild([file, '--to', 'docx', '--out', outB], ioB)).toBe(0);
    const [a, b] = await Promise.all([
      readFile(join(outA, 'report.tebin.docx')),
      readFile(join(outB, 'report.tebin.docx')),
    ]);
    expect(Buffer.compare(a, b)).toBe(0);
  });
});

describe('resolveConfig directly: precedence and defaults', () => {
  it('defaults to theme "plain", to ["pdf"], plainNames false, and no ingestOpts when nothing applies', async () => {
    const { file } = await fixture('# Report\n\nHello.\n');
    const resolved = await resolveConfig(file, { noConfig: false });
    expect(resolved).toEqual({ ingestOpts: {}, theme: 'plain', to: ['pdf'], plainNames: false });
  });

  it('a flag always outranks a sidecar for the same field', async () => {
    const { file } = await fixture('# Report\n\nHello.\n');
    await sidecarFor(file, { title: 'Sidecar Title', theme: 'tebin', to: ['docx'], plainNames: true });
    const resolved = await resolveConfig(file, {
      noConfig: false, title: 'Flag Title', theme: 'plain', to: ['pdf'], plainNames: false,
    });
    expect(resolved.ingestOpts.title).toBe('Flag Title');
    expect(resolved.theme).toBe('plain');
    expect(resolved.to).toEqual(['pdf']);
    expect(resolved.plainNames).toBe(false);
    expect(resolved.sidecarPath).toBe(sidecarPathFor(file));
  });
});

describe('fix round 1: inspect validates a sidecar\'s "to" the same way build does', () => {
  it('a sidecar naming a format this build cannot write refuses build with exit 2', async () => {
    const { file } = await fixture('# R\n\nHi.\n');
    await sidecarFor(file, { to: ['xlsx'] });
    const { io, err } = collect();
    expect(await runBuild([file], io)).toBe(2);
    expect(err.join('\n')).toMatch(/cannot write "xlsx" yet/);
  });

  it('inspect refuses the identical sidecar the identical way, for a single file — it must not green-light a build that will refuse', async () => {
    const { file } = await fixture('# R\n\nHi.\n');
    await sidecarFor(file, { to: ['xlsx'] });
    const { io, err } = collect();
    expect(await runInspect([file], io)).toBe(2);
    expect(err.join('\n')).toMatch(/cannot write "xlsx" yet/);
  });

  it('inspect refuses it in a batch too, folding it into that one document\'s failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-sidecar-to-batch-'));
    await writeFile(join(dir, 'a.md'), '# A\n\nHi.\n');
    await writeFile(join(dir, 'a.documentor.json'), JSON.stringify({ to: ['xlsx'] }));
    const { io, log } = collect();
    expect(await runInspect([dir, '--json'], io)).toBe(1);
    const result = JSON.parse(log.join('\n')) as InspectResult;
    const doc = result.documents[0]!;
    expect(doc.status).toBe('failed');
    if (doc.status !== 'failed') throw new Error('unreachable');
    expect(doc.reason).toMatch(/cannot write "xlsx" yet/);
  });
});

describe('fix round 1: the batch own-output guard survives a sidecar theme, on an identical rerun', () => {
  it('a second, identical run does not re-ingest the first run\'s sidecar-themed output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-sidecar-selfoutput-'));
    await writeFile(join(dir, 'g1.md'), '# G1\n\nHello.\n');
    await writeFile(join(dir, 'g1.documentor.json'), JSON.stringify({ theme: 'tebin' }));
    await writeFile(join(dir, 'g2.md'), '# G2\n\nHello.\n');

    const { io: io1, log: log1 } = collect();
    expect(await runBuild([dir, '--to', 'md'], io1)).toBe(0);
    expect(log1.join('\n')).toMatch(/2 written/);
    expect((await readdir(dir)).sort()).toEqual([
      'g1.documentor.json', 'g1.md', 'g1.tebin.md', 'g2.md', 'g2.plain.md',
    ]);

    const { io: io2, log: log2 } = collect();
    expect(await runBuild([dir, '--to', 'md'], io2)).toBe(0);
    const summary2 = log2.join('\n');
    // Nothing new was written, and both prior outputs are named as skipped
    // — g1.tebin.md would otherwise have been silently re-ingested as a
    // fresh source and written again as g1.tebin.plain.md, growing the
    // theme-id chain on every identical rerun. Only g1.md and g2.md — the
    // two genuine sources — count as this batch's documents; g2.plain.md
    // was already caught by discoverInputs' own walk-time filter (its
    // stem ends in the CLI-default theme id), and g1.tebin.md is now
    // caught by the new target-based check on top of it.
    expect(summary2).toMatch(/2 document\(s\)/);
    expect(summary2).toMatch(/2 skipped as this build's own prior output/);
    expect(summary2).toMatch(/g1\.tebin\.md/);
    expect(summary2).toMatch(/g2\.plain\.md/);
    expect((await readdir(dir)).sort()).toEqual([
      'g1.documentor.json', 'g1.md', 'g1.tebin.md', 'g2.md', 'g2.plain.md',
    ]);
  });
});

describe('fix round 1: a sidecar-named theme that does not exist', () => {
  it('is a usage error naming the sidecar, not a bare "theme not found" — exit 2 for a single file', async () => {
    const { file } = await fixture('# R\n\nHi.\n');
    const sidecar = await sidecarFor(file, { theme: 'nope' });
    const { io, err } = collect();
    expect(await runBuild([file, '--to', 'md'], io)).toBe(2);
    expect(err.join('\n')).toContain(`sidecar ${sidecar}`);
    expect(err.join('\n')).toMatch(/theme "nope" not found/);
  });

  it('folds into that one document\'s failure in a batch, still naming the sidecar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-sidecar-badtheme-batch-'));
    await writeFile(join(dir, 'a.md'), '# A\n\nHi.\n');
    await writeFile(join(dir, 'a.documentor.json'), JSON.stringify({ theme: 'nope' }));
    const { io, log } = collect();
    expect(await runBuild([dir, '--to', 'md'], io)).toBe(1);
    const summary = log.join('\n');
    expect(summary).toMatch(/1 had a sidecar/);
    expect(summary).toMatch(/theme "nope" not found/);
  });

  it('a bad --theme flag is unaffected — still the pre-existing uncaught-throw behaviour', async () => {
    const { file } = await fixture('# R\n\nHi.\n');
    const { io, err } = collect();
    await expect(runBuild([file, '--to', 'md', '--theme', 'nope'], io)).rejects.toThrow(/theme "nope" not found/);
    expect(err.join('\n')).toBe('');
  });
});

describe('fix round 1: "N had a sidecar" counts inputs that had one, not only ones that resolved', () => {
  it('counts a file whose sidecar was found but rejected (unknown key)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-sidecar-count-'));
    await writeFile(join(dir, 'good.md'), '# Good\n\nHi.\n');
    await writeFile(join(dir, 'bad.md'), '# Bad\n\nHi.\n');
    await writeFile(join(dir, 'bad.documentor.json'), JSON.stringify({ tittle: 'typo' }));
    const { io, log } = collect();
    expect(await runBuild([dir, '--to', 'md'], io)).toBe(1);
    expect(log.join('\n')).toMatch(/1 had a sidecar/);
  });

  it('counts a file whose sidecar was found but named a nonexistent theme', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-sidecar-count2-'));
    await writeFile(join(dir, 'a.md'), '# A\n\nHi.\n');
    await writeFile(join(dir, 'a.documentor.json'), JSON.stringify({ theme: 'nope' }));
    const { io, log } = collect();
    expect(await runBuild([dir, '--to', 'md'], io)).toBe(1);
    expect(log.join('\n')).toMatch(/1 had a sidecar/);
  });
});

describe('fix round 1: a sidecar path that exists but is a directory', () => {
  it('refuses loudly for a single file, instead of silently behaving as though none exists', async () => {
    const { file, dir } = await fixture('# R\n\nHi.\n');
    await mkdir(sidecarPathFor(file));
    const { io, err } = collect();
    expect(await runBuild([file, '--to', 'md'], io)).toBe(2);
    expect(err.join('\n')).toMatch(/exists but is not a file/);
    expect(err.join('\n')).toMatch(/directory/);
    // Nothing was written for the one document this run could not trust.
    expect((await readdir(dir)).sort()).toEqual(['report.documentor.json', 'report.md']);
  });

  it('is refused the same way in a batch, folded into that document\'s failure and still counted as having had one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'documentor-sidecar-dirsidecar-batch-'));
    await writeFile(join(dir, 'a.md'), '# A\n\nHi.\n');
    await mkdir(join(dir, 'a.documentor.json'));
    const { io, log } = collect();
    expect(await runBuild([dir, '--to', 'md'], io)).toBe(1);
    const summary = log.join('\n');
    expect(summary).toMatch(/1 had a sidecar/);
    expect(summary).toMatch(/exists but is not a file/);
  });
});
