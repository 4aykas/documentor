import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assembleProposal } from '../../src/proposal/assemble.js';
import { readProposalData } from '../../src/proposal/data.js';
import { ProposalError, type ProposalData } from '../../src/proposal/types.js';
import { validateDoc } from '../../src/ir/validate.js';
import { makeXlsx } from '../helpers/xlsx-fixture.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEMPLATE = readFileSync(join(ROOT, 'templates', 'offer.example.md'), 'utf8');
const DATA = readProposalData(readFileSync(join(ROOT, 'test', 'fixtures', 'offer-example.proposal.json'), 'utf8')).data;

const errorsOf = async (fn: () => Promise<unknown>): Promise<string[]> => {
  try { await fn(); } catch (e) { if (e instanceof ProposalError) return e.errors; throw e; }
  return [];
};

describe('assembleProposal', () => {
  it('assembles the example into a Doc the validator accepts', async () => {
    const { doc } = await assembleProposal({ data: DATA, template: TEMPLATE });
    expect(() => validateDoc(doc)).not.toThrow();
    expect(doc.meta.title).toBe('COMMERCIAL PROPOSAL — Example Project');
    expect(doc.meta.date).toBe('01.09.2026');
    const types = doc.blocks.map((b) => b.t);
    expect(types).toContain('heatmap');
    expect(types.filter((t) => t === 'table').length).toBeGreaterThanOrEqual(2); // summary + budget
  });

  it('splices each directive exactly where its line stood', async () => {
    const { doc } = await assembleProposal({ data: DATA, template: TEMPLATE });
    const i = doc.blocks.findIndex((b) => b.t === 'heading' && JSON.stringify(b.text).includes('SCHEDULE'));
    expect(i).toBeGreaterThan(-1);
    expect(doc.blocks[i + 1]?.t).toBe('heatmap');
  });

  it('carries no sentinel into the document', async () => {
    const { doc } = await assembleProposal({ data: DATA, template: TEMPLATE });
    expect(JSON.stringify(doc)).not.toContain('@@documentor-directive-');
  });

  it('fails when the covering summary line and the budget disagree, quoting both figures', async () => {
    const data: ProposalData = { ...DATA, summary: [{ item: 'Engineering works', priceCents: 500000, covers: 'budget' }] };
    const errs = await errorsOf(() => assembleProposal({ data, template: TEMPLATE }));
    expect(errs.join('\n')).toContain('5 000,00');
    expect(errs.join('\n')).toContain('4 500,00');
  });

  it('refuses an unknown directive by name', async () => {
    const errs = await errorsOf(() => assembleProposal({ data: DATA, template: '# T\n\n{{@discount}}\n' }));
    expect(errs.join('\n')).toMatch(/discount/);
  });

  it('refuses {{@annex}} with no annex supplied', async () => {
    const errs = await errorsOf(() => assembleProposal({ data: DATA, template: '# T\n\n{{@annex}}\n' }));
    expect(errs.join('\n')).toMatch(/annex/);
  });

  it('carries an annex register through the raised cap', async () => {
    const rows = [['No', 'Document'], ...Array.from({ length: 400 }, (_, i) => [String(i + 1), `DOC-${i + 1}`])];
    const annex = await makeXlsx(rows, 'Deliverables');
    const data: ProposalData = { ...DATA, annex: './deliverables.xlsx' };
    const { doc } = await assembleProposal({ data, template: TEMPLATE, annex });
    const tables = doc.blocks.filter((b) => b.t === 'table');
    expect(tables.some((t) => t.t === 'table' && t.rows.length >= 400)).toBe(true);
  });

  it('relays an annex refusal as a build failure, not half an offer', async () => {
    const rows = [['No', 'Document'], ...Array.from({ length: 2001 }, (_, i) => [String(i), 'x'])];
    const annex = await makeXlsx(rows);
    const data: ProposalData = { ...DATA, annex: './d.xlsx' };
    const errs = await errorsOf(() => assembleProposal({ data, template: TEMPLATE, annex }));
    expect(errs.join('\n')).toMatch(/refused/);
  });

  it('reports a directive that could not stand alone as its own paragraph', async () => {
    const errs = await errorsOf(() => assembleProposal({ data: DATA, template: '# T\n\n- a list item\n{{@budget}}\n' }));
    // Inside a tight list the sentinel is swallowed into the list block and
    // never becomes its own paragraph — the assembler must say so, not
    // silently drop the budget table.
    expect(errs.join('\n')).toMatch(/own paragraph|own line/);
  });

  // A 2×1 red PNG, same technique as test/render/docx.test.ts's PNG_2x1 —
  // real magic bytes so sniffRaster is genuinely exercised, not a fake string.
  const PNG_2x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkS7cAAAAAElFTkSuQmCC',
    'base64',
  );

  it('refuses {{@clientlogo}} with no clientLogo supplied, naming the directive', async () => {
    const errs = await errorsOf(() => assembleProposal({ data: DATA, template: '# T\n\n{{@clientlogo}}\n' }));
    expect(errs.join('\n')).toMatch(/clientlogo/);
  });

  it('turns clientLogo bytes into an image block with a data: URI, sniffed from the bytes', async () => {
    const data: ProposalData = { ...DATA, clientLogo: './client-logo.png' };
    const { doc } = await assembleProposal({ data, template: '# T\n\n{{@clientlogo}}\n', clientLogo: PNG_2x1 });
    const image = doc.blocks.find((b) => b.t === 'image');
    expect(image).toBeDefined();
    expect(image).toMatchObject({ t: 'image', src: expect.stringMatching(/^data:image\/png;base64,/) });
  });

  it('splices a {{@pagebreak}} directive where its line stood', async () => {
    const template = '# T\n\nBefore.\n\n{{@pagebreak}}\n\nAfter.\n';
    const { doc } = await assembleProposal({ data: DATA, template });
    const i = doc.blocks.findIndex((b) => b.t === 'pagebreak');
    expect(i).toBeGreaterThan(-1);
    expect(doc.blocks[i - 1]).toMatchObject({ t: 'para' });
    expect(doc.blocks[i + 1]).toMatchObject({ t: 'para' });
  });
});
