import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { proposalStem, runProposal } from '../../src/cli/proposal.js';
import { runInspect } from '../../src/cli/inspect.js';
import { docxPart } from '../helpers/docx-parts.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { log: (s: string) => out.push(s), err: (s: string) => err.push(s), out, errs: err };
};

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'documentor-proposal-'));
  // The fixture data names the template relative to the data file; copy both
  // into the temp dir so the test exercises exactly the path resolution the
  // CLI promises (relative to the data file's own directory).
  const template = readFileSync(join(ROOT, 'templates', 'offer.example.md'), 'utf8');
  await writeFile(join(dir, 'offer.template.md'), template, 'utf8');
  const data = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'offer-example.proposal.json'), 'utf8')) as Record<string, unknown>;
  data['template'] = './offer.template.md';
  await writeFile(join(dir, 'example.proposal.json'), JSON.stringify(data, null, 2), 'utf8');
});

describe('proposalStem', () => {
  it('strips the .proposal marker case-insensitively', () => {
    expect(proposalStem('EXAMPLE.PROPOSAL.JSON')).toBe('EXAMPLE');
    expect(proposalStem('example.proposal.json')).toBe('example');
    expect(proposalStem('example.Proposal.json')).toBe('example');
  });
});

describe('documentor proposal', () => {
  it('assembles and writes Word and Markdown beside the data file', async () => {
    const o = io();
    const code = await runProposal([join(dir, 'example.proposal.json'), '--to', 'docx,md'], o);
    expect(o.errs.join('\n')).toBe('');
    expect(code).toBe(0);
    // The stem drops the '.proposal' marker: example.proposal.json → example.plain.docx.
    expect(existsSync(join(dir, 'example.plain.docx'))).toBe(true);
    expect(existsSync(join(dir, 'example.plain.md'))).toBe(true);
    const xml = await docxPart(await readFile(join(dir, 'example.plain.docx')), 'word/document.xml');
    expect(xml).toContain('COMMERCIAL PROPOSAL');
  });

  it('is byte-identical across two runs', async () => {
    const a = io();
    await runProposal([join(dir, 'example.proposal.json'), '--to', 'docx'], a);
    const first = await readFile(join(dir, 'example.plain.docx'));
    await new Promise((r) => setTimeout(r, 1100)); // cross a DOS-timestamp second
    await runProposal([join(dir, 'example.proposal.json'), '--to', 'docx'], a);
    expect(first.equals(await readFile(join(dir, 'example.plain.docx')))).toBe(true);
  });

  it('exits 2 on a data file whose errors it lists — all of them', async () => {
    const o = io();
    await writeFile(join(dir, 'bad.proposal.json'), JSON.stringify({ template: './offer.template.md', bogus: 1 }), 'utf8');
    const code = await runProposal([join(dir, 'bad.proposal.json')], o);
    expect(code).toBe(2);
    const text = o.errs.join('\n');
    expect(text).toMatch(/bogus/);
    expect(text).toMatch(/kind is required/);
  });

  it('exits 2 on a missing template, naming the path it tried', async () => {
    const o = io();
    const data = JSON.parse(readFileSync(join(dir, 'example.proposal.json'), 'utf8')) as Record<string, unknown>;
    data['template'] = './no-such.template.md';
    await writeFile(join(dir, 'orphan.proposal.json'), JSON.stringify(data), 'utf8');
    const code = await runProposal([join(dir, 'orphan.proposal.json')], o);
    expect(code).toBe(2);
    expect(o.errs.join('\n')).toMatch(/no-such\.template\.md/);
  });

  it('exits 2 on a non-.json input and on an unknown format', async () => {
    const o = io();
    expect(await runProposal([join(dir, 'offer.template.md')], o)).toBe(2);
    expect(await runProposal([join(dir, 'example.proposal.json'), '--to', 'xlsx'], o)).toBe(2);
  });

  it('exits 2 on an unreadable client logo, naming the path it tried', async () => {
    const o = io();
    const data = JSON.parse(readFileSync(join(dir, 'example.proposal.json'), 'utf8')) as Record<string, unknown>;
    data['clientLogo'] = './no-such-logo.png';
    await writeFile(join(dir, 'nologo.proposal.json'), JSON.stringify(data), 'utf8');
    const code = await runProposal([join(dir, 'nologo.proposal.json')], o);
    expect(code).toBe(2);
    expect(o.errs.join('\n')).toMatch(/no-such-logo\.png/);
  });

  it('prints the data file warnings without failing the build', async () => {
    const o = io();
    const data = JSON.parse(readFileSync(join(dir, 'example.proposal.json'), 'utf8')) as { team: { hoursPerWeek: number[] }[] };
    data.team[0]!.hoursPerWeek = [0, 0, 0, 0, 0];
    // Zero hours also moves the budget away from the covering summary line —
    // adjust the summary so only the warning, not the cross-check, fires.
    (data as unknown as Record<string, unknown>)['summary'] = [{ item: 'Engineering works', price: 3600, covers: 'budget' }];
    await writeFile(join(dir, 'warn.proposal.json'), JSON.stringify(data), 'utf8');
    const code = await runProposal([join(dir, 'warn.proposal.json'), '--to', 'md'], o);
    expect(code).toBe(0);
    expect(o.errs.join('\n')).toMatch(/zero hours/);
  });
});

describe('documentor inspect <data.json>', () => {
  it('reports what would be assembled, without writing anything', async () => {
    const o = io();
    const code = await runInspect([join(dir, 'example.proposal.json'), '--json'], o);
    expect(code).toBe(0);
    const parsed = JSON.parse(o.out.join('\n')) as {
      status: string; title: string; weeks: number; roles: string[];
      budgetTotal: string; sections: string[]; annex: boolean; warnings: string[];
    };
    expect(parsed.status).toBe('ok');
    expect(parsed.title).toBe('COMMERCIAL PROPOSAL — Example Project');
    expect(parsed.weeks).toBe(5);
    expect(parsed.roles).toEqual(['BIM Coordinator', 'Mechanical Engineer']);
    expect(parsed.budgetTotal).toContain('4');
    expect(parsed.annex).toBe(false);
    expect(existsSync(join(dir, 'example.plain.pdf'))).toBe(false);
  });

  it('lists every validation error and exits 2', async () => {
    const o = io();
    await writeFile(join(dir, 'broken.proposal.json'), JSON.stringify({ template: './offer.template.md', bogus: 1 }), 'utf8');
    const code = await runInspect([join(dir, 'broken.proposal.json'), '--json'], o);
    expect(code).toBe(2);
    const parsed = JSON.parse(o.out.join('\n')) as { status: string; errors: string[] };
    expect(parsed.status).toBe('failed');
    expect(parsed.errors.join('\n')).toMatch(/bogus/);
  });
});

// The cover is the proposal feature's most-worked surface and, until this
// existed, nothing built one from a template through the CLI: the zones, the
// statement band, the key/value block and the corner mark were covered at
// renderer level and by one pixel baseline made from hand-written IR. A
// template is where a user meets the feature, so a template is what this
// tests — and templates/proposal-cover.example.md is the same file the
// README points them at, not a fixture that could drift from it.
describe('documentor proposal — the cover example template', () => {
  let coverDir: string;
  beforeAll(async () => {
    coverDir = await mkdtemp(join(tmpdir(), 'documentor-cover-'));
    const template = readFileSync(join(ROOT, 'templates', 'proposal-cover.example.md'), 'utf8');
    await writeFile(join(coverDir, 'cover.template.md'), template, 'utf8');
    const data = JSON.parse(
      readFileSync(join(ROOT, 'templates', 'proposal-cover.example.json'), 'utf8'),
    ) as Record<string, unknown>;
    data['template'] = './cover.template.md';
    await writeFile(join(coverDir, 'cover.proposal.json'), JSON.stringify(data, null, 2), 'utf8');
  });

  it('draws all three zones, the band and the key/value block', async () => {
    const o = io();
    const code = await runProposal([join(coverDir, 'cover.proposal.json'), '--to', 'docx'], o);
    expect(code).toBe(0);
    // The template's own HTML comments are the only thing reported as left
    // out — they explain the zones to whoever copies the file, and no
    // document format carries a comment.
    expect(o.errs.join('\n')).not.toMatch(/cannot be assembled|warning/);
    const xml = await docxPart(await readFile(join(coverDir, 'cover.plain.docx')), 'word/document.xml');

    const tables = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];
    // The panel, the metadata block, the statement band, then the body's own
    // summary/schedule/budget tables.
    expect(tables.length).toBeGreaterThanOrEqual(3);
    const [panel, meta, band] = tables;
    expect(panel).toContain('COMMERCIAL PROPOSAL');
    expect(panel).toContain('ENGINEERING SERVICE');

    // The metadata block: an empty header row is dropped, and with it the row
    // rules — the label sits beside its value, not under a banded grid.
    expect(meta).toContain('Proposal No.');
    expect(meta).not.toContain('w:val="DocTableHeader"');

    // The band carries the template's own sentence, in the CoverStatement style.
    expect(band).toContain('Example Project');
    expect(band).toContain('w:val="CoverStatement"');

    // The mark is anchored outside the panel table, and the foot is framed to
    // the page's bottom margin.
    expect(xml.indexOf('<w:drawing>')).toBeLessThan(xml.indexOf('<w:tbl>'));
    expect(xml).toContain('w:yAlign="bottom"');
  });

  it('drops nothing but the template\'s own comments', async () => {
    const o = io();
    await runProposal([join(coverDir, 'cover.proposal.json'), '--to', 'md'], o);
    // Every "left out" line is an HTML comment the template writes for the
    // reader; anything else would be content the cover lost.
    const dropped = [...o.out, ...o.errs].filter((l) => l.trim().startsWith('- '));
    expect(dropped.every((l) => l.includes('block html: <!--')), dropped.join('\n')).toBe(true);
  });
});
