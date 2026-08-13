import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { proposalStem, runProposal } from '../../src/cli/proposal.js';
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
