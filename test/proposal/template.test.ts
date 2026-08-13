import { describe, expect, it } from 'vitest';
import { flattenTemplate, parseTemplate } from '../../src/proposal/template.js';
import { ProposalError, type ProposalData } from '../../src/proposal/types.js';

const DATA: ProposalData = {
  template: 't.md', kind: 'COMMERCIAL OFFER', project: 'BER01', date: '13.04.2026',
  author: { name: 'A. Sheronov', email: 'a@tebin.pro' },
  team: [{ role: 'Electrical', rateCents: 4500, hoursPerWeek: [8, 8] }],
  currency: 'EUR',
  sections: { general: 'The general text.' },
  stage: 'LP5',
};

const flat = (src: string, data: ProposalData = DATA) => flattenTemplate(parseTemplate(src), data);
const errorsOf = (fn: () => unknown): string[] => {
  try { fn(); } catch (e) { if (e instanceof ProposalError) return e.errors; throw e; }
  return [];
};

describe('parseTemplate', () => {
  it('reads text, fields, presence blocks and directives', () => {
    const nodes = parseTemplate('# {{kind}}\n{{?stage}}Stage: {{stage}}{{/?}}\n{{@budget}}\n');
    expect(nodes.map((n) => n.t)).toEqual(['text', 'field', 'text', 'presence', 'text', 'directive', 'text']);
  });

  it('refuses an unclosed presence block', () => {
    expect(errorsOf(() => parseTemplate('{{?stage}}never closed')).join('\n')).toMatch(/\{\{\?stage\}\}.*not closed/s);
  });

  it('refuses a stray close', () => {
    expect(errorsOf(() => parseTemplate('text {{/?}} more')).join('\n')).toMatch(/\{\{\/\?\}\}.*no open/s);
  });

  it('refuses a token it cannot read, quoting it', () => {
    expect(errorsOf(() => parseTemplate('{{not a field!}}')).join('\n')).toMatch(/not a field!/);
  });

  it('requires a directive to stand alone on its line', () => {
    expect(errorsOf(() => parseTemplate('Total: {{@budget}}')).join('\n')).toMatch(/own line/);
  });

  it('collects several errors in one pass', () => {
    const errs = errorsOf(() => parseTemplate('{{bad token}} and {{another one}}'));
    expect(errs).toHaveLength(2);
  });
});

describe('flattenTemplate', () => {
  it('substitutes fields, including dotted paths', () => {
    const items = flat('By {{author.name}} for {{project}}.');
    expect(items).toEqual([{ t: 'md', text: 'By A. Sheronov for BER01.' }]);
  });

  it('keeps a present presence block and drops an absent one', () => {
    expect(flat('{{?stage}}Stage: {{stage}}. {{/?}}End.')).toEqual([{ t: 'md', text: 'Stage: LP5. End.' }]);
    const noStage: ProposalData = { ...DATA };
    delete (noStage as Partial<ProposalData>).stage;
    expect(flat('{{?stage}}Stage: {{stage}}. {{/?}}End.', noStage)).toEqual([{ t: 'md', text: 'End.' }]);
  });

  it('renders an absence block only when the field is absent', () => {
    const src = '{{^sections.assumptions}}Default assumptions.{{/^}}';
    expect(flat(src)).toEqual([{ t: 'md', text: 'Default assumptions.' }]);
    expect(flat(src, { ...DATA, sections: { ...DATA.sections, assumptions: 'Mine.' } })).toEqual([]);
  });

  it('turns {{section:name}} into that section’s own markdown', () => {
    expect(flat('Before.\n{{section:general}}\nAfter.')).toEqual([
      { t: 'md', text: 'Before.\nThe general text.\nAfter.' },
    ]);
  });

  it('fails on a field with no value, naming the field', () => {
    expect(errorsOf(() => flat('{{docNumber}}')).join('\n')).toMatch(/docNumber/);
  });

  it('fails on a section the data does not carry, naming it', () => {
    expect(errorsOf(() => flat('{{section:exclusions}}')).join('\n')).toMatch(/exclusions/);
  });

  it('keeps a directive as its own item between merged text', () => {
    const items = flat('Above.\n\n{{@heatmap style=marks}}\n\nBelow.');
    expect(items).toEqual([
      { t: 'md', text: 'Above.\n\n' },
      { t: 'directive', name: 'heatmap', args: { style: 'marks' } },
      { t: 'md', text: '\n\nBelow.' },
    ]);
  });

  it('refuses an object-valued field as not printable', () => {
    expect(errorsOf(() => flat('{{author}}')).join('\n')).toMatch(/author.*not a printable value/s);
  });
});
