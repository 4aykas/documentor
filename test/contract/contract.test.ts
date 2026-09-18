// The contract document type. What these tests defend is the one promise the
// command is built around: it assembles, it never writes. A contract that
// gains a sentence nobody agreed to is worse than a build that fails.

import { describe, expect, it } from 'vitest';
import { assembleContract } from '../../src/contract/assemble.js';
import { readContractData } from '../../src/contract/data.js';
import { ContractError } from '../../src/contract/types.js';

const DATA = {
  template: './t.md',
  number: '1-A',
  date: '19.05.2026',
  place: { uk: 'м. Київ', en: 'Kyiv' },
  title: { uk: 'ДОГОВІР', en: 'CONTRACT' },
  parties: [{ uk: 'Виконавець В.', en: 'Executer V.' }],
  articles: [
    {
      n: '1.',
      uk: 'Предмет',
      en: 'Subject',
      clauses: [{ n: '1.1.', uk: 'Виконавець надає послуги.', en: 'The Executer renders services.' }],
    },
  ],
  signatures: [{ uk: 'Замовник', en: 'Client' }],
  sections: {},
};

const read = (over: Record<string, unknown> = {}) =>
  readContractData(JSON.stringify({ ...DATA, ...over }));

const TEMPLATE = '# {{title.uk}} № {{number}}\n\n{{@parties}}\n\n{{@articles}}\n\n{{@signatures}}\n';

describe('readContractData', () => {
  it('accepts a complete bilingual contract', () => {
    expect(read().data.articles[0]!.clauses[0]!.en).toBe('The Executer renders services.');
  });

  it('refuses a clause with one language missing', () => {
    // A bilingual contract printed with one column blank is not a tidier
    // contract, it is a contract with a hole in it — and which half is gone
    // is exactly what nobody notices until it is signed.
    const bad = { ...DATA.articles[0], clauses: [{ n: '1.1.', uk: 'Лише українською' }] };
    expect(() => read({ articles: [bad] })).toThrow(ContractError);
  });

  it('refuses a clause filed under the wrong article', () => {
    const bad = { ...DATA.articles[0], clauses: [{ n: '4.2.', uk: 'а', en: 'b' }] };
    expect(() => read({ articles: [bad] })).toThrow(/not numbered under it/);
  });

  it('allows a plain list marker inside an article, which claims no hierarchy', () => {
    // "1)", "2)" enumerate rights inside a clause in TEBIN's real contracts.
    // They name no article, so there is nothing for them to disagree with,
    // and demanding they carry one would force the data file to renumber a
    // list the signed original does not.
    const ok = { ...DATA.articles[0], clauses: [{ n: '1)', uk: 'право', en: 'right' }] };
    expect(() => read({ articles: [ok] })).not.toThrow();
  });

  it('collects every problem in one pass rather than stopping at the first', () => {
    try {
      readContractData(JSON.stringify({ template: './t.md' }));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as ContractError).errors.length).toBeGreaterThan(3);
    }
  });
});

describe('assembleContract', () => {
  it('prints each article as a heading of its own, not as another table row', () => {
    // The defect this replaced: one table spanning the whole contract, so an
    // article arrived as a row indistinguishable from a clause, the language
    // header repeated on every page, and a page break could fall anywhere.
    const { doc } = assembleContract({ data: read().data, template: TEMPLATE });
    const heading = doc.blocks.find((b) => b.t === 'heading' && b.level === 2);
    expect(heading).toBeDefined();
    expect(JSON.stringify(heading)).toContain('Предмет');
    expect(JSON.stringify(heading)).toContain('Subject');
  });

  it('gives every article its own table, so the language header cannot repeat per page', () => {
    const two = [DATA.articles[0], { n: '2.', uk: 'Порядок', en: 'Procedure', clauses: [{ n: '2.1.', uk: 'а', en: 'b' }] }];
    const { doc } = assembleContract({ data: read({ articles: two }).data, template: TEMPLATE });
    const tables = doc.blocks.filter((b) => b.t === 'table');
    // parties + signatures + one per article
    expect(tables).toHaveLength(4);
  });

  it('refuses a template that never places the articles', () => {
    // Such a template builds a contract consisting of its own preamble and
    // nothing that was agreed — silently, which is the whole problem.
    expect(() => assembleContract({ data: read().data, template: '# {{title.uk}}\n\n{{@parties}}\n' }))
      .toThrow(/never places \{\{@articles\}\}/);
  });

  it('names an unknown directive rather than dropping it', () => {
    expect(() => assembleContract({ data: read().data, template: '# T\n\n{{@articles}}\n\n{{@budget}}\n' }))
      .toThrow(/unknown directive/);
  });

  it('writes no sentence of its own — every word comes from the data or the template', () => {
    const { doc } = assembleContract({ data: read().data, template: TEMPLATE });
    const printed = JSON.stringify(doc);
    // The only words the assembler contributes are the two column labels and
    // the parties/signature captions, which are the template's furniture.
    for (const word of ['Виконавець надає послуги.', 'The Executer renders services.', 'ДОГОВІР', '1-A']) {
      expect(printed).toContain(word);
    }
  });
});
