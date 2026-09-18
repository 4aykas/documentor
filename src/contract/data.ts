// JSON text → a validated ContractData. Collects every error before throwing,
// the same contract data.ts keeps for proposals: the message is the checklist
// for fixing the file, not the first line of it.

import {
  ContractError,
  type ContractArticle,
  type ContractClause,
  type ContractData,
  type ContractParty,
  type ContractSignature,
} from './types.js';

const TOP_KEYS = new Set([
  'template', 'number', 'date', 'place', 'title', 'parties', 'articles', 'signatures', 'sections',
]);

export function readContractData(jsonText: string): { data: ContractData; warnings: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new ContractError([`the data file is not valid JSON: ${(e as Error).message}`]);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ContractError(['the data file must hold one JSON object']);
  }
  const d = parsed as Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const key of Object.keys(d)) {
    if (!TOP_KEYS.has(key)) errors.push(`unknown key ${JSON.stringify(key)} — this file accepts ${[...TOP_KEYS].join(', ')}`);
  }

  const str = (v: unknown, at: string): string | undefined => {
    if (typeof v !== 'string' || v === '') {
      errors.push(`${at}: expected a non-empty string`);
      return undefined;
    }
    return v;
  };

  const template = str(d['template'], 'template');
  const number = str(d['number'], 'number');
  const date = str(d['date'], 'date');

  /** A bilingual pair. Both languages are required everywhere: a contract
   *  printed in two columns with one of them blank is not a bilingual
   *  contract, it is a contract with a hole in it, and which half is missing
   *  is exactly what nobody notices until it is signed. */
  const pair = (v: unknown, at: string): { uk: string; en: string } | undefined => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      errors.push(`${at}: expected { uk, en }`);
      return undefined;
    }
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      if (k !== 'uk' && k !== 'en') errors.push(`${at}: unknown key ${JSON.stringify(k)}`);
    }
    const uk = str(o['uk'], `${at}.uk`);
    const en = str(o['en'], `${at}.en`);
    return uk === undefined || en === undefined ? undefined : { uk, en };
  };

  const place = pair(d['place'], 'place');
  const title = pair(d['title'], 'title');

  const pairList = (v: unknown, at: string): { uk: string; en: string }[] => {
    if (!Array.isArray(v) || v.length === 0) {
      errors.push(`${at}: expected a non-empty array of { uk, en }`);
      return [];
    }
    return v.map((raw, i) => pair(raw, `${at}[${i}]`)).filter((p): p is ContractParty => p !== undefined);
  };

  const parties: ContractParty[] = pairList(d['parties'], 'parties');
  const signatures: ContractSignature[] = pairList(d['signatures'], 'signatures');

  const articles: ContractArticle[] = [];
  const rawArticles = d['articles'];
  if (!Array.isArray(rawArticles) || rawArticles.length === 0) {
    errors.push('articles: expected a non-empty array — a contract with no articles has nothing to agree');
  } else {
    rawArticles.forEach((raw, i) => {
      const at = `articles[${i}]`;
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        errors.push(`${at}: expected an object`);
        return;
      }
      const a = raw as Record<string, unknown>;
      for (const k of Object.keys(a)) {
        if (!['n', 'uk', 'en', 'clauses'].includes(k)) errors.push(`${at}: unknown key ${JSON.stringify(k)}`);
      }
      const n = str(a['n'], `${at}.n`);
      const uk = str(a['uk'], `${at}.uk`);
      const en = str(a['en'], `${at}.en`);

      const clauses: ContractClause[] = [];
      const rawClauses = a['clauses'];
      if (rawClauses !== undefined) {
        if (!Array.isArray(rawClauses)) {
          errors.push(`${at}.clauses: expected an array of { n, uk, en }`);
        } else {
          rawClauses.forEach((rc, j) => {
            const cAt = `${at}.clauses[${j}]`;
            if (typeof rc !== 'object' || rc === null || Array.isArray(rc)) {
              errors.push(`${cAt}: expected an object`);
              return;
            }
            const c = rc as Record<string, unknown>;
            for (const k of Object.keys(c)) {
              if (!['n', 'uk', 'en'].includes(k)) errors.push(`${cAt}: unknown key ${JSON.stringify(k)}`);
            }
            const cn = str(c['n'], `${cAt}.n`);
            const cuk = str(c['uk'], `${cAt}.uk`);
            const cen = str(c['en'], `${cAt}.en`);
            if (cn !== undefined && cuk !== undefined && cen !== undefined) {
              clauses.push({ n: cn, uk: cuk, en: cen });
            }
          });
        }
      }
      if (clauses.length === 0) {
        warnings.push(`${at} (${uk ?? '?'}) carries no clauses — deliberate, or clauses that have not been filled in yet?`);
      }
      if (n !== undefined && uk !== undefined && en !== undefined) {
        articles.push({ n, uk, en, clauses });
      }
    });

    // A clause whose number does not sit under its article's is a
    // cross-reference waiting to point at the wrong obligation. Cheap to
    // check here, expensive to discover in a signed contract.
    //
    // Only dotted numbers are checked, because only they claim a place in
    // the hierarchy: "4.2." says it belongs to article 4 and can therefore
    // be wrong about it. A plain list marker — "1)", "2)", the form these
    // contracts use for the rights enumerated inside a clause — names no
    // article, so there is nothing for it to disagree with, and demanding
    // that it start with its article's number would only force the data file
    // to renumber a list the signed original does not.
    for (const a of articles) {
      for (const c of a.clauses) {
        if (!c.n.includes('.')) continue;
        if (!c.n.startsWith(a.n.replace(/\.$/, ''))) {
          errors.push(`articles ${a.n}: clause ${c.n} is not numbered under it — a clause and its article must agree, or every reference to either is wrong`);
        }
      }
    }
  }

  const sections: Record<string, string> = {};
  const rawSections = d['sections'];
  if (rawSections !== undefined) {
    if (typeof rawSections !== 'object' || rawSections === null || Array.isArray(rawSections)) {
      errors.push('sections: expected an object of markdown strings');
    } else {
      for (const [key, v] of Object.entries(rawSections as Record<string, unknown>)) {
        if (typeof v !== 'string') errors.push(`sections.${key}: expected a markdown string`);
        else sections[key] = v;
      }
    }
  }

  if (errors.length > 0) throw new ContractError(errors);
  return {
    data: {
      template: template!, number: number!, date: date!,
      place: place!, title: title!,
      parties, articles, signatures, sections,
    },
    warnings,
  };
}
