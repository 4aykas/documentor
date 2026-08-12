# documentor phase 2 — themes and Word: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the TEBIN theme from the brand's own design tokens, and render the IR to a branded, byte-reproducible Word document.

**Architecture:** A vendored snapshot of the `tebin-style` tokens and logo is the only input to a pure generator that writes `themes/tebin/theme.json`; a test regenerates and requires a zero diff. A new `src/render/docx.ts` renders the same IR the PDF and Markdown renderers consume, through the `docx` library, with its zip and metadata normalised so two builds produce identical bytes. The agreement test becomes a harness with one extractor per renderer, and DOCX — which carries emphasis, cell boundaries and link targets as structure — closes three of its phase-1 blind spots.

**Tech Stack:** TypeScript (ESM, `nodenext`), Node ≥22, vitest, the `docx` library, the existing `playwright-core` PDF path.

## Global Constraints

- **Byte-identical twice.** Every renderer must produce identical bytes for the same input on the same platform. No `Date.now()`, no wall clock: dates come from `SOURCE_DATE_EPOCH` or the input's mtime, passed in as `epochSeconds`.
- **The renderer fetches nothing.** No network call at render time, ever. `test/guardrails/no-wall-clock.test.ts` greps for both and fails the build.
- **Scratch files stay out of the repo.** The checkout is inside a OneDrive-synced tree; `dist/`, browser caches and scratch output live outside it.
- **Anything the IR cannot hold is dropped loudly**, never silently.
- **A logo paints by class.** No inline `fill`/`stroke`, in an attribute, a `style="…"` or an embedded `<style>` — `resolveTheme` refuses all three.
- **`colors.brandOnLight` paints fills and large display type only.** It is not a small-text colour; see the design's "The line under brandOnLight".
- Language for code comments, docs and commit messages: English.
- Commit after every task. Do not push.

## File structure

**Created:**

| Path | Responsibility |
|:--|:--|
| `brand/tebin/tokens.dtcg.json` | Vendored token snapshot, copied from `tebin-style` theme `tebin-classic` |
| `brand/tebin/logo-full.svg` | Vendored logo, as published (paints through an embedded `<style>`) |
| `brand/tebin/logo-full.png` | Vendored raster logo, 512px wide, for Word |
| `brand/tebin/SOURCE.md` | Where the snapshot came from, which version, and how to refresh it |
| `src/theme/generate.ts` | Pure: tokens + assets → a theme object. Includes the logo recolour |
| `src/theme/generate-tebin.ts` | The `npm run theme:tebin` entry: read `brand/tebin/`, write `themes/tebin/theme.json` |
| `themes/tebin/theme.json` | Generated. Never hand-edited — a test proves it |
| `NOTICE` | Code is MIT; the brand assets under `brand/` and `themes/tebin/` are not |
| `src/render/docx.ts` | IR + theme → a `.docx` buffer |
| `src/render/normalize-docx.ts` | Makes a packed `.docx` byte-reproducible, as `normalize-pdf.ts` does for a PDF |
| `test/helpers/docx-parts.ts` | Reads one part out of a `.docx` buffer, for the read-back tests |
| `test/theme/generate.test.ts` | Unit tests for the recolour and the token mapping |
| `test/theme/tebin-in-sync.test.ts` | Regenerating the theme changes nothing |
| `test/render/docx.test.ts` | Reads the produced package back |
| `test/agreement/runs.ts` | One run-extractor per renderer, shared |
| `test/agreement/agree.test.ts` | Every renderer against Markdown as the reference |

**Modified:**

| Path | Change |
|:--|:--|
| `src/theme/types.ts` | `Logo` gains `png` |
| `src/theme/resolve.ts` | Validates `logo.png`; exports `findInlinePaint` for the generator |
| `src/cli/build.ts` | `--to docx` |
| `test/baseline/kitchen-sink.test.ts` | The agreement half moves out to `test/agreement/` |
| `test/render/links.test.ts` | A third renderer joins the refusal-parity check |
| `package.json` | `docx` dependency, `theme:tebin` script |
| `README.md` | Word output, and how to refresh the brand snapshot |

**A deviation from the spec, with its reason:** the spec put the snapshot at `themes/tebin/.tokens/`. It goes to `brand/tebin/` instead. `package.json` publishes the whole `themes/` directory, and the snapshot is build input, not a runtime asset — shipping it would mean every consumer downloads the tokens and the source logo they cannot use. `brand/` is not in `files`.

---

### Task 1: A theme may carry a raster logo

Word cannot be trusted with an SVG, so the theme carries the same mark twice. It stays a `data:` URI inside `theme.json`, because "a brand plugs in through one JSON file" is the design's promise and a second file beside it would break it.

**Files:**
- Modify: `src/theme/types.ts` (the `Logo` type)
- Modify: `src/theme/resolve.ts` (the logo branch of `resolveTheme`)
- Test: `test/theme/resolve.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Logo = { svg: string; heightPt: number; png: string | null }`. `png` is a `data:image/png;base64,…` URI or `null`. Task 3 emits it; Task 9 reads it.

- [ ] **Step 1: Write the failing tests**

Add to `test/theme/resolve.test.ts`, inside the existing `describe` that covers the logo:

```ts
const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

it('carries a raster logo beside the vector one', () => {
  const t = resolveTheme({
    id: 't',
    logo: { svg: '<svg><path class="c-brand" d="M0 0"/></svg>', heightPt: 11, png: PNG_1x1 },
  });
  expect(t.logo?.png).toBe(PNG_1x1);
});

it('defaults the raster logo to null rather than undefined', () => {
  const t = resolveTheme({ id: 't', logo: { svg: '<svg></svg>', heightPt: 11 } });
  expect(t.logo?.png).toBeNull();
});

it('refuses a logo.png that is not an inline PNG data URI', () => {
  for (const png of ['./logo.png', 'https://example.com/logo.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=']) {
    expect(() => resolveTheme({ id: 't', logo: { svg: '<svg></svg>', heightPt: 11, png } })).toThrow(
      /logo\.png/,
    );
  }
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/theme/resolve.test.ts`
Expected: FAIL — `t.logo.png` is `undefined`, and the refusal test throws nothing.

- [ ] **Step 3: Widen the type**

In `src/theme/types.ts`, inside `Logo`:

```ts
export type Logo = {
  /** Inline SVG markup. Paints by class, never with an inline fill. */
  svg: string;
  heightPt: number;
  /**
   * The same mark as a raster, inline as a data: URI, for formats that cannot
   * be trusted with an SVG — Word's support for one is version-dependent. Null
   * when the theme supplies only a vector: a renderer that needs a raster then
   * prints the letterhead without a mark rather than substituting anything.
   *
   * A PNG is not repainted by a class, so this one does NOT follow the theme's
   * colours. A theme wanting a mark in Word supplies its own raster.
   */
  png: string | null;
};
```

- [ ] **Step 4: Validate it**

In `src/theme/resolve.ts`, beside the other module-level patterns:

```ts
const PNG_DATA_URI = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
```

and inside the `if (rawLogo !== undefined && rawLogo !== null)` branch, after the inline-paint check and before `logo = …`:

```ts
    const rawPng = l['png'];
    if (rawPng !== undefined && rawPng !== null && (typeof rawPng !== 'string' || !PNG_DATA_URI.test(rawPng))) {
      bad('logo.png', 'expected an inline "data:image/png;base64,…" URI, or null — a theme is one file, so a path to a raster beside it is not accepted');
    }
    logo = {
      svg: l['svg'],
      heightPt: num(l['heightPt'], 'logo.heightPt', 11),
      png: (rawPng as string | null | undefined) ?? null,
    };
```

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run && npm run typecheck`
Expected: PASS. If another test asserted on the whole `logo` object, add `png: null` to its expectation — the field is now always present.

- [ ] **Step 6: Commit**

```bash
git add src/theme/types.ts src/theme/resolve.ts test/theme/resolve.test.ts
git commit -m "Let a theme carry its mark as a raster too"
```

---

### Task 2: Recolour the published logo so the theme owns its colours

The logo as published paints through an embedded `<style>` with `.cls-1`/`.cls-2`. `resolveTheme` refuses that shape. The generator rewrites it into the semantic classes the stylesheet already styles.

**Files:**
- Create: `brand/tebin/tokens.dtcg.json`, `brand/tebin/logo-full.svg`, `brand/tebin/logo-full.png`, `brand/tebin/SOURCE.md`, `NOTICE`
- Create: `src/theme/generate.ts`
- Modify: `src/theme/resolve.ts` (export `findInlinePaint`)
- Test: `test/theme/generate.test.ts`

**Interfaces:**
- Consumes: `findInlinePaint(svg: string): { where: string; found: string } | null` from `src/theme/resolve.ts`.
- Produces: `recolourLogo(svg: string, tokens: Tokens): string` and `type Tokens = Record<string, string>` — a flat map of token name (`brand`, `grey`, `ink`, …) to its hex value, exported from `src/theme/generate.ts`. Task 3 uses both.

- [ ] **Step 1: Vendor the brand snapshot**

Create `brand/tebin/` and fill it from the `tebin-style` MCP server, theme id `tebin-classic`:

- `tokens.dtcg.json` — the `content` string of `get_theme({ id: 'tebin-classic', format: 'dtcg' })`, written verbatim.
- `logo-full.svg` — the `content` of `get_asset({ id: 'tebin-classic', assetId: 'logo-full' })`, verbatim.
- `logo-full.png` — the base64 `content` of `get_asset({ id: 'tebin-classic', assetId: 'logo-full@512' })`, decoded to bytes.

Then `brand/tebin/SOURCE.md`:

```markdown
# Brand snapshot — TEBIN

Copied from the `tebin-style` design system, theme `tebin-classic` v1.0.0, on
2026-08-12. `tebin-classic` is the print theme: it is the one whose `ink` and
`topbar` are the values a document is set in. The web theme `tebin` is a
lighter palette and is not what a printed document should use.

This directory is the only input to `npm run theme:tebin`. It is vendored
rather than fetched so the generator runs offline and so refreshing the brand
is an explicit commit whose diff shows what moved.

To refresh: replace these files from the same source, run `npm run theme:tebin`,
and commit the snapshot and the regenerated `themes/tebin/theme.json` together.

Licence: the tokens are MIT. The logo files are © TEBIN, all rights reserved —
see NOTICE at the repository root.
```

And `NOTICE` at the repository root:

```
documentor is licensed under the MIT License; see LICENSE.

It also contains TEBIN brand assets, which are not:

  brand/tebin/logo-full.svg
  brand/tebin/logo-full.png
  the "logo" field of themes/tebin/theme.json

  © TEBIN — all rights reserved.

The design tokens in brand/tebin/tokens.dtcg.json are MIT, as published by the
tebin-style design system.

Using this software does not grant any right to use the TEBIN name or marks.
Replace the theme with your own.
```

- [ ] **Step 2: Write the failing tests**

Create `test/theme/generate.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { recolourLogo, type Tokens } from '../../src/theme/generate.js';
import { findInlinePaint } from '../../src/theme/resolve.js';

const BRAND = join(fileURLToPath(new URL('../../', import.meta.url)), 'brand', 'tebin');
const TOKENS: Tokens = { brand: '#DA291C', grey: '#898D8D', ink: '#1A1A1A' };

describe('recolourLogo', () => {
  const published = readFileSync(join(BRAND, 'logo-full.svg'), 'utf8');

  it('replaces the published classes with semantic ones', () => {
    const out = recolourLogo(published, TOKENS);
    expect(out).toContain('class="c-brand"');
    expect(out).toContain('class="c-muted"');
    expect(out).not.toContain('cls-1');
    expect(out).not.toContain('cls-2');
  });

  it('leaves nothing resolveTheme would refuse', () => {
    // The generator applies the resolver's own check rather than a copy of it:
    // a logo that the generator accepts and the resolver rejects is the worst
    // of both, because it fails at load time in someone else's project.
    expect(findInlinePaint(recolourLogo(published, TOKENS))).toBeNull();
  });

  it('drops the XML prolog, which is invalid inside an HTML document', () => {
    expect(recolourLogo(published, TOKENS)).not.toContain('<?xml');
  });

  it('is deterministic', () => {
    expect(recolourLogo(published, TOKENS)).toBe(recolourLogo(published, TOKENS));
  });

  it('names a colour it cannot attribute to a token, instead of guessing', () => {
    const svg = '<svg><defs><style>.cls-1 { fill: #00FF00; }</style></defs><path class="cls-1" d="M0 0"/></svg>';
    expect(() => recolourLogo(svg, TOKENS)).toThrow(/#00FF00/);
  });

  it('matches a token colour whatever case it is written in', () => {
    const svg = '<svg><defs><style>.cls-1 { fill: #da291c; }</style></defs><path class="cls-1" d="M0 0"/></svg>';
    expect(recolourLogo(svg, TOKENS)).toContain('class="c-brand"');
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run test/theme/generate.test.ts`
Expected: FAIL — `src/theme/generate.ts` does not exist.

- [ ] **Step 4: Export the resolver's check**

In `src/theme/resolve.ts`, change `function findInlinePaint` to `export function findInlinePaint`. Nothing else moves: the generator must apply the identical check, not a second implementation of it.

- [ ] **Step 5: Write the recolour**

Create `src/theme/generate.ts`:

```ts
// Brand tokens + the published assets → a documentor theme. Pure: the caller
// reads the snapshot and writes the result, so this file has no filesystem and
// no network of its own and can be tested with a string.

import { findInlinePaint } from './resolve.js';

/** A flat token name → hex map, lifted out of the DTCG file. */
export type Tokens = Record<string, string>;

/**
 * Which semantic class a brand token becomes in a logo. The host stylesheet
 * (see the .logo rules in render/html.ts) paints these from the theme's own
 * colours, which is what stops the mark drifting from the document around it.
 */
const CLASS_FOR_TOKEN: Record<string, string> = {
  brand: 'c-brand',
  grey: 'c-muted',
  ink: 'c-ink',
};

/**
 * The published logo paints through an embedded <style> element:
 *
 *   .cls-1 { fill: #898D8D; }  .cls-2 { fill: #DA291C; }
 *
 * which is exactly the inline paint a theme may not carry — it silently beats
 * the class, so the mark would stop following the theme with nothing visible to
 * explain why. This reads that map, attributes every colour to a brand token,
 * renames the classes to the semantic ones, and deletes the <style> element.
 *
 * A colour that matches no token throws, naming the colour. Guessing here would
 * reintroduce precisely the drift the generated theme exists to prevent.
 */
export function recolourLogo(svg: string, tokens: Tokens): string {
  const byColour = new Map<string, string>();
  for (const [name, value] of Object.entries(tokens)) {
    const cls = CLASS_FOR_TOKEN[name];
    if (cls) byColour.set(value.toLowerCase(), cls);
  }

  const rename = new Map<string, string>();
  for (const styleEl of svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of (styleEl[1] ?? '').matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
      const declared = rule[2] ?? '';
      const paint = declared.match(/\b(?:fill|stroke)\s*:\s*(#[0-9a-fA-F]{6})/);
      if (!paint) continue;
      const colour = paint[1]!;
      const semantic = byColour.get(colour.toLowerCase());
      if (!semantic) {
        throw new Error(
          `logo colour ${colour} (class .${rule[1]}) matches no brand token — add it to the token source or fix the asset; the generator will not guess a class for it`,
        );
      }
      rename.set(rule[1]!, semantic);
    }
  }

  let out = svg
    .replace(/<\?xml[^>]*\?>\s*/g, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>\s*/gi, '')
    .replace(/<defs>\s*<\/defs>\s*/gi, '');
  for (const [from, to] of rename) {
    out = out.replace(new RegExp(`class="${from}"`, 'g'), `class="${to}"`);
  }
  out = out.trim();

  const leftover = findInlinePaint(out);
  if (leftover) {
    throw new Error(`recoloured logo still carries inline paint: ${leftover.where} (${leftover.found})`);
  }
  return out;
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/theme/generate.test.ts && npm run typecheck`
Expected: PASS, all six.

- [ ] **Step 7: Commit**

```bash
git add brand NOTICE src/theme/generate.ts src/theme/resolve.ts test/theme/generate.test.ts
git commit -m "Vendor the brand snapshot, and make its logo paint by class"
```

---

### Task 3: Generate the TEBIN theme, and prove it stays generated

**Files:**
- Modify: `src/theme/generate.ts` (add `buildTheme`)
- Create: `src/theme/generate-tebin.ts`
- Create: `themes/tebin/theme.json` (generated output, committed)
- Modify: `package.json` (the `theme:tebin` script)
- Test: `test/theme/generate.test.ts`, `test/theme/tebin-in-sync.test.ts`

**Interfaces:**
- Consumes: `recolourLogo`, `Tokens` from Task 2; `resolveTheme` from `src/theme/resolve.ts`.
- Produces: `readTokens(dtcgJson: string): Tokens` and `buildTheme(args: { tokens: Tokens; logoSvg: string; logoPngBase64: string; sourceId: string; sourceVersion: string }): unknown` — the theme as a plain object ready to be `JSON.stringify`'d. Task 9 consumes the produced `themes/tebin/theme.json` through `loadTheme('tebin')`.

- [ ] **Step 1: Write the failing tests**

Append to `test/theme/generate.test.ts`:

```ts
import { buildTheme, readTokens } from '../../src/theme/generate.js';
import { resolveTheme } from '../../src/theme/resolve.js';

describe('readTokens', () => {
  it('flattens the DTCG colour and font groups', () => {
    const dtcg = readFileSync(join(BRAND, 'tokens.dtcg.json'), 'utf8');
    const tokens = readTokens(dtcg);
    expect(tokens['brand']).toBe('#DA291C');
    expect(tokens['grey']).toBe('#898D8D');
    expect(tokens['ink']).toBe('#1A1A1A');
    expect(tokens['grey-lighter']).toBe('#CDCDCE');
    expect(tokens['font-document']).toBe('Arial');
  });

  it('refuses a token file with no brand colour rather than defaulting one', () => {
    expect(() => readTokens('{"color":{"ink":{"$type":"color","$value":"#1A1A1A"}}}')).toThrow(/brand/);
  });
});

describe('buildTheme', () => {
  const built = () =>
    buildTheme({
      tokens: readTokens(readFileSync(join(BRAND, 'tokens.dtcg.json'), 'utf8')),
      logoSvg: readFileSync(join(BRAND, 'logo-full.svg'), 'utf8'),
      logoPngBase64: readFileSync(join(BRAND, 'logo-full.png')).toString('base64'),
      sourceId: 'tebin-classic',
      sourceVersion: '1.0.0',
    });

  it('maps every colour from a brand token, inventing none', () => {
    const t = resolveTheme(built());
    expect(t.colors.brandOnLight).toBe('#DA291C');
    expect(t.colors.ink).toBe('#1A1A1A');
    expect(t.colors.muted).toBe('#898D8D');
    expect(t.colors.rule).toBe('#CDCDCE');
    expect(t.font.document).toBe('Arial');
  });

  it('leaves brandOnDark null, because the brand publishes no second red', () => {
    expect(resolveTheme(built()).colors.brandOnDark).toBeNull();
  });

  it('produces a theme the resolver accepts, logo and all', () => {
    const t = resolveTheme(built());
    expect(t.logo?.svg).toContain('c-brand');
    expect(t.logo?.png?.startsWith('data:image/png;base64,')).toBe(true);
    expect(t.letterhead[0]).toBe('TEBIN.PRO Sp. z o.o.');
  });

  it('records which fields the brand did not decide', () => {
    const t = built() as { $generated: { source: string; version: string; notFromBrand: string[] } };
    expect(t.$generated.source).toBe('tebin-classic');
    expect(t.$generated.version).toBe('1.0.0');
    expect(t.$generated.notFromBrand).toContain('page');
    expect(t.$generated.notFromBrand).toContain('type');
    expect(t.$generated.notFromBrand).toContain('letterhead');
  });

  it('is deterministic', () => {
    expect(JSON.stringify(built())).toBe(JSON.stringify(built()));
  });
});
```

Create `test/theme/tebin-in-sync.test.ts`:

```ts
// themes/tebin/theme.json is generated. This is the only thing standing between
// that sentence and a hand-edit that quietly makes it false.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildTheme, readTokens, themeJson } from '../../src/theme/generate.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BRAND = join(ROOT, 'brand', 'tebin');

describe('themes/tebin/theme.json', () => {
  it('is exactly what the generator produces from the vendored snapshot', () => {
    const regenerated = themeJson(
      buildTheme({
        tokens: readTokens(readFileSync(join(BRAND, 'tokens.dtcg.json'), 'utf8')),
        logoSvg: readFileSync(join(BRAND, 'logo-full.svg'), 'utf8'),
        logoPngBase64: readFileSync(join(BRAND, 'logo-full.png')).toString('base64'),
        sourceId: 'tebin-classic',
        sourceVersion: '1.0.0',
      }),
    );
    const committed = readFileSync(join(ROOT, 'themes', 'tebin', 'theme.json'), 'utf8');
    expect(
      committed.replace(/\r\n/g, '\n'),
      'themes/tebin/theme.json is generated — run `npm run theme:tebin` and commit the result, rather than editing it',
    ).toBe(regenerated);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/theme/`
Expected: FAIL — `readTokens`, `buildTheme` and `themeJson` do not exist.

- [ ] **Step 3: Implement the mapping**

Append to `src/theme/generate.ts`:

```ts
/**
 * The DTCG file groups tokens by type; a theme wants a flat lookup. Group and
 * name are joined with a dash for everything but colours, which are the common
 * case and keep their bare names: `brand`, `grey-lighter`, `font-document`.
 */
export function readTokens(dtcgJson: string): Tokens {
  const parsed = JSON.parse(dtcgJson) as Record<string, Record<string, { $value?: unknown }>>;
  const out: Tokens = {};
  for (const [group, members] of Object.entries(parsed)) {
    for (const [name, token] of Object.entries(members)) {
      const value = token.$value;
      const flat = Array.isArray(value) ? value[0] : value;
      if (typeof flat !== 'string') continue;
      out[group === 'color' ? name : `${group}-${name}`] = flat;
    }
  }
  if (!out['brand']) {
    throw new Error('token source carries no color.brand — this is not a brand token file, and the generator will not default a brand colour');
  }
  return out;
}

/** Fails loudly rather than falling back: an absent token is a snapshot problem. */
function token(tokens: Tokens, name: string): string {
  const v = tokens[name];
  if (!v) throw new Error(`token source carries no ${name}`);
  return v;
}

/**
 * The letterhead, the page geometry and the type scale have no brand token
 * behind them — the 2017 brand book does not price them. They are the theme
 * author's, and `$generated.notFromBrand` says so in the file itself, the same
 * way the brand pack marks `ink` and `topbar` as not specified in the book.
 */
const LETTERHEAD = [
  'TEBIN.PRO Sp. z o.o.',
  'Plac Hołdu Pruskiego 9, 70-550 Szczecin, Poland',
  'www.tebin.pro | info@tebin.pro',
  'NIP: 9552562516 | REGON: 521434962',
];

export function buildTheme(args: {
  tokens: Tokens;
  logoSvg: string;
  logoPngBase64: string;
  sourceId: string;
  sourceVersion: string;
}): unknown {
  const { tokens } = args;
  return {
    id: 'tebin',
    name: 'TEBIN',
    $generated: {
      by: 'npm run theme:tebin',
      source: args.sourceId,
      version: args.sourceVersion,
      // Everything the brand does not decide, named here so a reader of this
      // file can tell authority from taste without going to look.
      notFromBrand: ['page', 'type', 'letterhead', 'logo.heightPt'],
    },
    colors: {
      // A fill colour, and large display type. Not a small-text colour: no
      // single red clears AA on both a light and a dark surface, and the brand
      // publishes a separate #C7251A for red text on white.
      brandOnLight: token(tokens, 'brand'),
      // The brand publishes one red. A renderer needing a dark-surface red must
      // fail loudly rather than reuse this one.
      brandOnDark: null,
      ink: token(tokens, 'ink'),
      muted: token(tokens, 'grey'),
      rule: token(tokens, 'grey-lighter'),
    },
    font: { document: token(tokens, 'font-document'), embed: 'arimo' },
    logo: {
      svg: recolourLogo(args.logoSvg, tokens),
      heightPt: 11,
      png: `data:image/png;base64,${args.logoPngBase64}`,
    },
    page: { size: 'A4', marginPt: 48 },
    type: { bodyPt: 10, leading: 1.45, h1Pt: 18, h2Pt: 13, h3Pt: 11, smallPt: 8 },
    letterhead: LETTERHEAD,
  };
}

/** One serialisation, so the writer and the in-sync test cannot disagree. */
export function themeJson(theme: unknown): string {
  return `${JSON.stringify(theme, null, 2)}\n`;
}
```

- [ ] **Step 4: Write the generator entry**

Create `src/theme/generate-tebin.ts`:

```ts
// `npm run theme:tebin`. Reads only brand/tebin/ and writes only
// themes/tebin/theme.json — no network, so it runs in an offline CI, and the
// snapshot's diff is the record of what the brand changed.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTheme, readTokens, themeJson } from './generate.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BRAND = join(ROOT, 'brand', 'tebin');

const [dtcg, logoSvg, logoPng] = await Promise.all([
  readFile(join(BRAND, 'tokens.dtcg.json'), 'utf8'),
  readFile(join(BRAND, 'logo-full.svg'), 'utf8'),
  readFile(join(BRAND, 'logo-full.png')),
]);

const out = themeJson(
  buildTheme({
    tokens: readTokens(dtcg),
    logoSvg,
    logoPngBase64: logoPng.toString('base64'),
    sourceId: 'tebin-classic',
    sourceVersion: '1.0.0',
  }),
);

const target = join(ROOT, 'themes', 'tebin', 'theme.json');
await writeFile(target, out, 'utf8');
process.stdout.write(`wrote ${target}\n`);
```

Add the script to `package.json`:

```json
    "theme:tebin": "tsx src/theme/generate-tebin.ts",
```

- [ ] **Step 5: Generate the theme and run everything**

Run: `npm run theme:tebin && npx vitest run && npm run typecheck`
Expected: `themes/tebin/theme.json` appears, and every test passes including the in-sync one.

Then run `npm run theme:tebin` a second time and confirm `git diff --stat themes/tebin/theme.json` is empty. A generator that is not idempotent cannot be gated by a diff.

- [ ] **Step 6: Commit**

```bash
git add src/theme/generate.ts src/theme/generate-tebin.ts themes/tebin/theme.json package.json test/theme/
git commit -m "Generate the TEBIN theme from the brand's own tokens"
```

---

### Task 4: Print a real document in the TEBIN theme

The theme is not proven by its JSON. This renders the kitchen sink through it, checks the logo actually takes the theme's colours, and puts a human in front of the page before its image becomes a baseline.

**Files:**
- Test: `test/baseline/tebin.test.ts`
- Create: `test/baseline/__baseline__/tebin-page-01.png` (after human approval)

**Interfaces:**
- Consumes: `loadTheme('tebin')` — the file Task 3 generated; `renderPdf`, `rasterPages` as used by `test/baseline/kitchen-sink.test.ts`.
- Produces: nothing later tasks import.

- [ ] **Step 1: Write the test**

Create `test/baseline/tebin.test.ts`, modelled on `test/baseline/kitchen-sink.test.ts` — read that file first and copy its browser lifecycle, its `resetPdfjsWorkerGlobal`, its `HERE`/`EPOCH` constants and its baseline-comparison shape exactly, then:

```ts
describe('the TEBIN theme', () => {
  it('paints the logo by class, so the theme owns its colours', async () => {
    const theme = await loadTheme('tebin');
    const { doc } = ingestMarkdown(source);
    const html = await buildHtml(doc, theme, { headerHeightPt: 40 });
    // The mark carries the classes and the stylesheet carries the rules; if
    // either half goes missing the logo prints solid black, which is SVG's
    // initial fill and reads at a glance as "the stylesheet did not load".
    expect(html).toContain('class="c-brand"');
    expect(html).toContain('.logo .c-brand{ fill: var(--brand); }');
    expect(html).toContain('--brand: #DA291C;');
  });

  it('prints the letterhead the entity actually uses', async () => {
    const theme = await loadTheme('tebin');
    const { doc } = ingestMarkdown(source);
    const html = await buildHtml(doc, theme, { headerHeightPt: 40 });
    expect(html).toContain('TEBIN.PRO Sp. z o.o.');
    expect(html).toContain('NIP: 9552562516 | REGON: 521434962');
  });

  it('page one matches its committed image', async () => {
    const theme = await loadTheme('tebin');
    const { doc } = ingestMarkdown(source);
    resetPdfjsWorkerGlobal();
    const pages = await rasterPages(await renderPdf(doc, theme, { epochSeconds: EPOCH, browser }));
    await mkdir(ACTUAL, { recursive: true });
    await writeFile(join(ACTUAL, 'tebin-page-01.png'), pages[0]!);
    const golden = join(BASELINE, 'tebin-page-01.png');
    expect(existsSync(golden), 'no baseline yet — review test/baseline/__actual__/tebin-page-01.png and copy it into __baseline__ if it is correct').toBe(true);
    expect(pages[0]!.equals(await readFile(golden))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch the first two pass and the third fail**

Run: `npx vitest run test/baseline/tebin.test.ts`
Expected: the two markup assertions PASS; the image test FAILS with "no baseline yet".

If either markup assertion fails, stop: the theme is wrong, not the baseline.

- [ ] **Step 3: STOP — a human approves the page**

Show `test/baseline/__actual__/tebin-page-01.png` to the user and ask whether the branded first page is right — the mark's colour and size, the letterhead's four lines, the tick and hairline. A baseline nobody looked at is a snapshot of a bug.

Do not proceed without an answer.

- [ ] **Step 4: Adopt the approved image**

```bash
cp test/baseline/__actual__/tebin-page-01.png test/baseline/__baseline__/tebin-page-01.png
```

Run: `npx vitest run test/baseline/tebin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/baseline/tebin.test.ts test/baseline/__baseline__/tebin-page-01.png
git commit -m "Print the kitchen sink in the TEBIN theme, and pin the page"
```

---

## What the spike measured

Tasks 5–11 are written from `docs/superpowers/notes/2026-08-12-docx-spike.md`, which was measured on this machine. Read it before starting Task 5. The findings the plan depends on:

- `docx@9.7.1`, and `jszip@3.10.1` already in the tree beneath it.
- Two `Packer.toBuffer` calls **differ**, in one process and across processes, in exactly three ways: every zip entry's DOS timestamp, the two `dcterms` dates in `docProps/core.xml`, and the `nanoid`-derived relationship id of every `ExternalHyperlink`. Nothing else — no `w:docId`, no rsids.
- The PDF's in-place substitution does not transfer: the ids deflate to different sizes and the zip carries CRCs. The package is rewritten, not patched.
- **Two builds inside the same second look reproducible** — the DOS stamp has two-second resolution. A byte-identity test that does not normalise can pass for the wrong reason.
- **Custom styles named `Heading1`/`Heading2`/`Heading3` collide** with the built-in set `docx` always emits, producing duplicate `w:styleId`. Hence the `Doc…` prefix everywhere below. `importedStyles: []` is not the escape hatch: it also drops `<w:docDefaults>` and the `Hyperlink` style.
- `headers.default` becomes `word/header1.xml` and `headers.first` becomes `word/header2.xml` — part numbering follows option order, not page order.
- Units: `run.size` half-points, table widths DXA (20 per point), border `size` eighths of a point, `ImageRun.transformation` pixels at 96 dpi (points × 4/3), colours six hex digits with no `#`.
- `<w:t>` is always emitted as `<w:t xml:space="preserve">`; a test matching bare `<w:t>` finds nothing.
- The option is **`italics`**, not `italic`.

**Where the plan uses an option the spike did not measure** — `outlineLevel`, `indent`, `keepNext`, `TextRun.break` — the task's test asserts on the emitted XML for exactly that option, so an API guess fails at step 2 rather than in a document.

---

### Task 5: Make a packed .docx reproducible

**Files:**
- Create: `src/render/normalize-docx.ts`
- Create: `test/helpers/docx-parts.ts`
- Create: `test/render/normalize-docx.test.ts`
- Modify: `package.json` (`docx` and `jszip` as dependencies)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `normalizeDocx(buf: Buffer, epochSeconds: number): Promise<Buffer>` from `src/render/normalize-docx.ts`, and `docxPart(buf: Buffer, name: string): Promise<string>` plus `docxEntries(buf: Buffer): Promise<string[]>` from `test/helpers/docx-parts.ts`. Every later task uses all three.

- [ ] **Step 1: Install the dependencies**

```bash
npm install docx jszip
```

`jszip` is already in the tree beneath `docx`, but the normaliser is production code and an undeclared import is a bet on hoisting. Confirm `npm audit --omit=dev` still reports zero — the spike measured it clean, and this is the phase's chance to notice if that changed.

- [ ] **Step 2: Write the read-back helper**

Create `test/helpers/docx-parts.ts`:

```ts
// A .docx is a zip. Every read-back assertion in this suite goes through here,
// so a test never has to know that.

import JSZip from 'jszip';

export async function docxPart(buf: Buffer, name: string): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file(name);
  if (!file) throw new Error(`no such part: ${name} (the package has ${Object.keys(zip.files).join(', ')})`);
  return await file.async('string');
}

export async function docxEntries(buf: Buffer): Promise<string[]> {
  return Object.keys((await JSZip.loadAsync(buf)).files);
}
```

- [ ] **Step 3: Write the failing test**

Create `test/render/normalize-docx.test.ts`:

```ts
import { Document, ExternalHyperlink, Packer, Paragraph, TextRun } from 'docx';
import { describe, expect, it } from 'vitest';
import { normalizeDocx } from '../../src/render/normalize-docx.js';
import { docxEntries, docxPart } from '../helpers/docx-parts.js';

const EPOCH = 1_000_000_000;

/** Carries a hyperlink on purpose: its relationship id is the one thing that
 *  differs between two packs regardless of how fast they run. */
const build = () =>
  Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun({ text: 'A document.' })] }),
            new Paragraph({
              children: [
                new ExternalHyperlink({
                  link: 'https://tebin.pro/',
                  children: [new TextRun({ text: 'tebin.pro', style: 'Hyperlink' })],
                }),
              ],
            }),
          ],
        },
      ],
    }),
  );

describe('normalizeDocx', () => {
  it('two packs of the same document differ before it runs', async () => {
    // If this ever stops being true the normaliser may be unnecessary — but it
    // must not be deleted on the strength of a run inside one second, which is
    // the whole reason this assertion is here rather than assumed.
    const [a, b] = await Promise.all([build(), build()]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('and are byte-identical after it', async () => {
    const a = await normalizeDocx(Buffer.from(await build()), EPOCH);
    const b = await normalizeDocx(Buffer.from(await build()), EPOCH);
    expect(a.equals(b)).toBe(true);
  });

  it('writes the epoch into the document properties', async () => {
    const core = await docxPart(await normalizeDocx(Buffer.from(await build()), EPOCH), 'docProps/core.xml');
    expect(core).toContain('2001-09-09T01:46:40Z');
    expect(core).not.toMatch(/20[2-9]\d-/);
  });

  it('renumbers the random hyperlink id in the part and in its relationships', async () => {
    const out = await normalizeDocx(Buffer.from(await build()), EPOCH);
    const part = await docxPart(out, 'word/document.xml');
    const rels = await docxPart(out, 'word/_rels/document.xml.rels');
    expect(part).toContain('r:id="rIdLink1"');
    expect(rels).toContain('Id="rIdLink1"');
    expect(rels).toContain('Target="https://tebin.pro/"');
  });

  it('keeps every entry the package had', async () => {
    const before = await docxEntries(Buffer.from(await build()));
    const after = await docxEntries(await normalizeDocx(Buffer.from(await build()), EPOCH));
    expect(after).toEqual(before);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run test/render/normalize-docx.test.ts`
Expected: FAIL — `src/render/normalize-docx.ts` does not exist.

- [ ] **Step 5: Write the normaliser**

Create `src/render/normalize-docx.ts`. This is the spike's measured code; the header comment carries the reason it looks nothing like `normalize-pdf.ts`.

```ts
// A .docx packed twice from the same input is not the same file. Three things
// move: every zip entry's DOS timestamp (JSZip stamps new Date()), the
// dcterms:created / dcterms:modified pair in docProps/core.xml (docx hardcodes
// the wall clock and offers no option), and the relationship id of every
// external hyperlink (a nanoid off Math.random()).
//
// normalize-pdf.ts substitutes fixed-width bytes in place and leaves the xref
// valid. That cannot work here: the ids deflate to different sizes and every
// zip entry carries a CRC and a local-header offset. So the package is
// unpacked, edited and rebuilt. Measured 2026-08-12: rebuilding with JSZip
// reproduces docx's own DEFLATE output — of 28 entries only the three actually
// edited change CRC or compressed size — and Word opens the result with no
// repair prompt.

import JSZip from 'jszip';

/** A docx-generated hyperlink id: "rId" followed by a 21-character nanoid. */
const RANDOM_RID = /rId[a-z0-9_-]{21}/g;

export async function normalizeDocx(buf: Buffer, epochSeconds: number): Promise<Buffer> {
  const stamp = new Date(epochSeconds * 1000);
  const iso = stamp.toISOString().replace(/\.\d{3}Z$/, 'Z');

  const src = await JSZip.loadAsync(buf);
  const names = Object.keys(src.files);
  const parts = new Map<string, Buffer | null>();
  for (const name of names) {
    const f = src.files[name];
    if (f === undefined) continue;
    parts.set(name, f.dir ? null : await f.async('nodebuffer'));
  }

  const core = parts.get('docProps/core.xml');
  if (core != null) {
    parts.set(
      'docProps/core.xml',
      Buffer.from(
        core.toString('utf8').replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*(<)/g, `$1${iso}$2`),
        'utf8',
      ),
    );
  }

  // A relationship id is local to its part, so the renumbering is too: the same
  // id must be rewritten in the part and in that part's own .rels, and nowhere
  // else. Numbered by order of first appearance, which is deterministic
  // because the part's own content is.
  for (const name of names) {
    if (!/^word\/.*\.xml$/.test(name)) continue;
    const relName = name.replace(/([^/]+)$/, '_rels/$1.rels');
    const part = parts.get(name);
    const rel = parts.get(relName);
    if (part == null || rel == null) continue;
    const xml = part.toString('utf8');
    const seen: string[] = [];
    for (const m of xml.matchAll(RANDOM_RID)) if (!seen.includes(m[0])) seen.push(m[0]);
    if (seen.length === 0) continue;
    const map = new Map(seen.map((id, i) => [id, `rIdLink${i + 1}`]));
    const sub = (s: string): string => s.replace(RANDOM_RID, (id) => map.get(id) ?? id);
    parts.set(name, Buffer.from(sub(xml), 'utf8'));
    parts.set(relName, Buffer.from(sub(rel.toString('utf8')), 'utf8'));
  }

  const out = new JSZip();
  for (const name of names) {
    const data = parts.get(name);
    if (data === undefined) continue;
    // createFolders belongs on file(), not on generateAsync — JSZip's types
    // reject it there, and a folder entry invented on the way out would change
    // the entry list.
    if (data === null) out.file(name, '', { dir: true, date: stamp, createFolders: false });
    else out.file(name, data, { date: stamp, createFolders: false, binary: true });
  }
  return await out.generateAsync({
    type: 'nodebuffer',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  });
}
```

- [ ] **Step 6: Run the tests and the guardrails**

Run: `npx vitest run test/render/normalize-docx.test.ts test/guardrails/ && npm run typecheck`
Expected: PASS. The wall-clock guardrail greps for `new Date(` — it must accept `new Date(epochSeconds * 1000)`; if it does not, read `test/guardrails/no-wall-clock.test.ts` and extend its allowance the way `normalize-pdf.ts` is already allowed, rather than weakening the grep.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/render/normalize-docx.ts test/helpers/docx-parts.ts test/render/normalize-docx.test.ts
git commit -m "Make a packed .docx reproducible"
```

---

### Task 6: Render the IR to Word

The bulk of the renderer: the theme's styles, the inline switch, and every block except the letterhead. Images take the placeholder path here; Task 7 teaches it to embed.

**Files:**
- Create: `src/render/docx.ts`
- Create: `test/render/docx.test.ts`
- Modify: `test/render/links.test.ts`

**Interfaces:**
- Consumes: `normalizeDocx` (Task 5), `docxPart`/`docxEntries` (Task 5), `schemeIsRefused`/`refusedLinkTarget` from `src/render/links.js`, `Theme` from `src/theme/types.js`.
- Produces: `renderDocx(doc: Doc, theme: Theme, opts: { epochSeconds: number }): Promise<Buffer>`. Style ids `DocTitle`, `DocSubtitle`, `DocH1`, `DocH2`, `DocH3`, `DocBody`, `DocList`, `DocQuote`, `DocCode`, `DocPlaceholder`, `DocLetterheadName`, `DocLetterheadLine`, `DocRunningHeader`, `DocTableHeader`, `DocTableCell`. Task 7 adds the image path; Task 8 adds the headers; Task 9 calls it from the CLI; Task 10 reads its output back.

- [ ] **Step 1: Write the failing tests**

Create `test/render/docx.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Doc } from '../../src/ir/types.js';
import { renderDocx } from '../../src/render/docx.js';
import { resolveTheme } from '../../src/theme/resolve.js';
import { docxPart } from '../helpers/docx-parts.js';

const EPOCH = 1_000_000_000;
const theme = resolveTheme({ id: 't', colors: { brandOnLight: '#DA291C', muted: '#898D8D', rule: '#CDCDCE' } });
const render = (doc: Doc) => renderDocx(doc, theme, { epochSeconds: EPOCH });
const body = async (doc: Doc) => docxPart(await render(doc), 'word/document.xml');
const doc = (...blocks: Doc['blocks']): Doc => ({ meta: { title: 'T', lang: 'en' }, blocks });

describe('renderDocx', () => {
  it('produces identical bytes on two runs', async () => {
    const d = doc(
      { t: 'para', text: [{ t: 'link', href: 'https://example.com', children: [{ t: 'text', v: 'x' }] }] },
      { t: 'para', text: [{ t: 'text', v: 'y' }] },
    );
    expect((await render(d)).equals(await render(d))).toBe(true);
  });

  it('styles headings with ids of its own, not the ones docx already defines', async () => {
    const styles = await docxPart(await render(doc({ t: 'heading', level: 2, text: [{ t: 'text', v: 'H' }] })), 'word/styles.xml');
    // docx always emits a built-in Heading1..6. A style of ours with the same
    // id would be a duplicate w:styleId and which one wins is undefined.
    expect(styles).toContain('w:styleId="DocH2"');
    expect(styles.match(/w:styleId="Heading2"/g)?.length ?? 0).toBe(1);
  });

  it('keeps a heading in Word’s outline', async () => {
    expect(await body(doc({ t: 'heading', level: 2, text: [{ t: 'text', v: 'H' }] }))).toContain('<w:outlineLvl w:val="1"/>');
  });

  it('carries emphasis as structure', async () => {
    const xml = await body(doc({
      t: 'para',
      text: [{ t: 'strong', children: [{ t: 'text', v: 'b' }] }, { t: 'em', children: [{ t: 'text', v: 'i' }] }],
    }));
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
  });

  it('numbers an ordered list from the IR’s own start', async () => {
    const xml = await body(doc({ t: 'list', ordered: true, depth: 0, start: 4, items: [[{ t: 'text', v: 'a' }], [{ t: 'text', v: 'b' }]] }));
    expect(xml).toContain('4.');
    expect(xml).toContain('5.');
  });

  it('indents a nested list by its depth', async () => {
    const xml = await body(doc({ t: 'list', ordered: false, depth: 2, items: [[{ t: 'text', v: 'deep' }]] }));
    expect(xml).toMatch(/<w:ind w:left="\d+"/);
  });

  it('breaks the page where the IR says to', async () => {
    expect(await body(doc({ t: 'pagebreak' }))).toContain('<w:br w:type="page"/>');
  });

  it('writes a table with an explicit grid and a cell width for every column', async () => {
    const xml = await body(doc({
      t: 'table',
      head: [[{ t: 'text', v: 'Item' }], [{ t: 'text', v: 'Qty' }]],
      rows: [[[{ t: 'text', v: 'Widget' }], [{ t: 'text', v: '12' }]]],
      align: ['l', 'r'],
    }));
    expect(xml).toContain('<w:tblGrid>');
    expect(xml).toMatch(/<w:gridCol w:w="\d+"\/><w:gridCol w:w="\d+"\/>/);
    expect(xml).toContain('<w:jc w:val="right"/>');
    expect(xml).toContain('Widget');
  });

  it('links out, and puts the target only in the relationships', async () => {
    const buf = await render(doc({ t: 'para', text: [{ t: 'link', href: 'https://example.com/a', children: [{ t: 'text', v: 'go' }] }] }));
    expect(await docxPart(buf, 'word/document.xml')).not.toContain('example.com');
    expect(await docxPart(buf, 'word/_rels/document.xml.rels')).toContain('Target="https://example.com/a"');
  });

  it('refuses an executable link scheme, the same as the other two renderers', async () => {
    const buf = await render(doc({ t: 'para', text: [{ t: 'link', href: 'javascript:alert(1)', children: [{ t: 'text', v: 'go' }] }] }));
    const xml = await docxPart(buf, 'word/document.xml');
    const rels = await docxPart(buf, 'word/_rels/document.xml.rels');
    expect(xml).not.toContain('<w:hyperlink');
    expect(rels).not.toContain('javascript');
    expect(xml).toContain('go');
    expect(xml).toContain('javascript:');
  });

  it('sets the document up for a different first page', async () => {
    const xml = await body(doc({ t: 'para', text: [{ t: 'text', v: 'x' }] }));
    expect(xml).toContain('<w:titlePg/>');
  });

  it('declares every relationship it references', async () => {
    // The failure this catches is not hypothetical: a part that references an
    // r:id its own .rels does not declare makes Word ask to repair the file,
    // for everyone it was sent to, on every open.
    const buf = await render(doc({ t: 'para', text: [{ t: 'link', href: 'https://example.com/a', children: [{ t: 'text', v: 'go' }] }] }));
    const part = await docxPart(buf, 'word/document.xml');
    const rels = await docxPart(buf, 'word/_rels/document.xml.rels');
    const declared = new Set([...rels.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]!));
    for (const m of part.matchAll(/r:(?:id|embed)="([^"]+)"/g)) {
      expect(declared.has(m[1]!), `word/document.xml references ${m[1]} but its .rels does not declare it`).toBe(true);
    }
  });

  it('prints the title, and the subtitle when there is one', async () => {
    const xml = await docxPart(
      await renderDocx({ meta: { title: 'Report', subtitle: 'Q3', lang: 'en' }, blocks: [] }, theme, { epochSeconds: EPOCH }),
      'word/document.xml',
    );
    expect(xml).toContain('Report');
    expect(xml).toContain('Q3');
  });
});
```

Then extend `test/render/links.test.ts` — a third renderer joins the parity check. Add the import and, inside the existing `describe('both renderers refuse the same link schemes')` (rename it to `every renderer refuses the same link schemes`), add to the refused loop:

```ts
      const docx = await docxPart(await renderDocx(linkDoc(href), docxTheme, { epochSeconds: 1_000_000_000 }), 'word/document.xml');
      expect(docx).not.toContain('<w:hyperlink');
      expect(docx).toContain('Click me');
```

and to the live loop:

```ts
      const buf = await renderDocx(linkDoc(href), docxTheme, { epochSeconds: 1_000_000_000 });
      expect(await docxPart(buf, 'word/_rels/document.xml.rels')).toContain(`Target="${href}"`);
```

with `const docxTheme = resolveTheme({ id: 't' });` beside the existing theme.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run test/render/docx.test.ts`
Expected: FAIL — `src/render/docx.ts` does not exist.

- [ ] **Step 3: Write the units and the styles**

Create `src/render/docx.ts`, starting with the parts that have no opinions:

```ts
// IR + theme → a Word document. The same IR the PDF and Markdown renderers
// consume; nothing here knows about Markdown or about HTML.
//
// Every measurement in this file has its own unit, and Word's units are not
// points: run sizes are half-points, table widths and indents are twentieths
// of a point (DXA), border widths are eighths, and an image is described in
// pixels at 96 dpi. The helpers below exist so a number in this file is always
// in points until the moment it stops being.

import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Packer, PageBreak,
  Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun,
  WidthType, type IParagraphOptions, type ParagraphChild,
} from 'docx';
import type { Block, Doc, Inline } from '../ir/types.js';
import { PAGE_PT, type Theme } from '../theme/types.js';
import { refusedLinkTarget, schemeIsRefused } from './links.js';
import { normalizeDocx } from './normalize-docx.js';

const halfPt = (pt: number): number => Math.round(pt * 2);
const dxa = (pt: number): number => Math.round(pt * 20);
const eighthPt = (pt: number): number => Math.round(pt * 8);
/** Word takes a colour as six hex digits with no leading hash. */
const hex = (colour: string): string => colour.replace('#', '').toUpperCase();

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'auto' } as const;
/** A borderless table is not the default: every edge has to be named. */
const NO_BORDERS = {
  top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
  insideHorizontal: NO_BORDER, insideVertical: NO_BORDER,
} as const;

/**
 * Style ids carry a Doc prefix because `docx` always emits its own built-in
 * set — Title, Heading1..6, Strong, ListParagraph, Hyperlink and the footnote
 * styles — and appends ours after it. A style of ours called `Heading1` would
 * be a second element with the same w:styleId, and which one a reader honours
 * is undefined. Measured 2026-08-12: Word 365 took the last, which is a
 * coincidence to design around rather than a rule to rely on.
 */
function styles(theme: Theme) {
  const { colors: c, type: ty } = theme;
  const para = (id: string, name: string, run: object, paragraph: object = {}) => ({
    id, name, basedOn: 'Normal', next: 'DocBody', quickFormat: true, run, paragraph,
  });
  return {
    default: {
      document: { run: { font: theme.font.document, size: halfPt(ty.bodyPt), color: hex(c.ink) } },
    },
    paragraphStyles: [
      para('DocTitle', 'Doc Title', { size: halfPt(ty.h1Pt), bold: true, color: hex(c.ink) }, { spacing: { before: dxa(11), after: dxa(2) } }),
      para('DocSubtitle', 'Doc Subtitle', { size: halfPt(ty.bodyPt), color: hex(c.muted) }, { spacing: { after: dxa(8) } }),
      para('DocH1', 'Doc Heading 1', { size: halfPt(ty.h1Pt), bold: true, color: hex(c.ink) }, { spacing: { before: dxa(11), after: dxa(3) }, keepNext: true }),
      para('DocH2', 'Doc Heading 2', { size: halfPt(ty.h2Pt), bold: true, color: hex(c.ink) }, { spacing: { before: dxa(9), after: dxa(2) }, keepNext: true }),
      para('DocH3', 'Doc Heading 3', { size: halfPt(ty.h3Pt), bold: true, color: hex(c.ink) }, { spacing: { before: dxa(7), after: dxa(1.5) }, keepNext: true }),
      para('DocBody', 'Doc Body', { size: halfPt(ty.bodyPt) }, { spacing: { line: Math.round(ty.leading * 240), after: dxa(ty.bodyPt * 0.7) } }),
      para('DocList', 'Doc List Item', { size: halfPt(ty.bodyPt) }, { spacing: { line: Math.round(ty.leading * 240), after: dxa(2) } }),
      para('DocQuote', 'Doc Quote', { size: halfPt(ty.bodyPt), color: hex(c.muted) }, {
        indent: { left: dxa(12) },
        border: { left: { style: BorderStyle.SINGLE, size: eighthPt(2), color: hex(c.rule), space: 6 } },
        spacing: { after: dxa(5) },
      }),
      para('DocCode', 'Doc Code', { font: 'Consolas', size: halfPt(ty.bodyPt * 0.86) }, {
        shading: { type: ShadingType.CLEAR, fill: 'F6F6F4', color: 'auto' },
        spacing: { line: 240, after: 0 },
      }),
      para('DocPlaceholder', 'Doc Placeholder', { size: halfPt(ty.bodyPt * 0.95), color: hex(c.muted) }, {
        border: { top: { style: BorderStyle.SINGLE, size: eighthPt(0.75), color: hex(c.rule), space: 6 },
                  bottom: { style: BorderStyle.SINGLE, size: eighthPt(0.75), color: hex(c.rule), space: 6 },
                  left: { style: BorderStyle.SINGLE, size: eighthPt(0.75), color: hex(c.rule), space: 6 },
                  right: { style: BorderStyle.SINGLE, size: eighthPt(0.75), color: hex(c.rule), space: 6 } },
        spacing: { after: dxa(8) },
      }),
      para('DocTableHeader', 'Doc Table Header', { size: halfPt(ty.bodyPt * 0.95), bold: true }, { spacing: { after: 0 } }),
      para('DocTableCell', 'Doc Table Cell', { size: halfPt(ty.bodyPt * 0.95) }, { spacing: { after: 0 } }),
      para('DocLetterheadName', 'Doc Letterhead Name', { size: halfPt(ty.smallPt + 0.5), bold: true, color: hex(c.muted) }, { alignment: AlignmentType.RIGHT, spacing: { after: 0 } }),
      para('DocLetterheadLine', 'Doc Letterhead Line', { size: halfPt(ty.smallPt - 0.5), color: hex(c.muted) }, { alignment: AlignmentType.RIGHT, spacing: { after: 0 } }),
      para('DocRunningHeader', 'Doc Running Header', { size: halfPt(ty.smallPt - 1), color: hex(c.muted) }, { spacing: { after: 0 } }),
    ],
  };
}
```

- [ ] **Step 4: Write the inline switch**

Append:

```ts
/**
 * Inline nodes → Word runs. Emphasis nests, so the formatting is carried down
 * rather than applied at the leaf: `**bold *and italic***` must arrive as one
 * run that is both.
 */
function inline(nodes: Inline[], fmt: { bold?: boolean; italics?: boolean; code?: boolean } = {}, theme: Theme): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes) {
    switch (n.t) {
      case 'text':
        out.push(new TextRun({
          text: n.v,
          ...(fmt.bold ? { bold: true } : {}),
          // The option is `italics`, not `italic`.
          ...(fmt.italics ? { italics: true } : {}),
          ...(fmt.code ? { font: 'Consolas' } : {}),
        }));
        break;
      case 'strong': out.push(...inline(n.children, { ...fmt, bold: true }, theme)); break;
      case 'em': out.push(...inline(n.children, { ...fmt, italics: true }, theme)); break;
      case 'code': out.push(...inline(n.children, { ...fmt, code: true }, theme)); break;
      case 'link':
        if (schemeIsRefused(n.href)) {
          // The same rule the HTML and Markdown renderers ask, and the same
          // shape of answer: the text, then where it pointed, in muted type.
          out.push(...inline(n.children, fmt, theme));
          out.push(new TextRun({ text: ` (${refusedLinkTarget(n.href)})`, color: hex(theme.colors.muted), size: halfPt(theme.type.bodyPt * 0.85) }));
        } else {
          // `Hyperlink` is a character style docx always emits, so this is the
          // one style id in the file without a Doc prefix: it is theirs, not
          // ours, and naming it is how the link text looks like a link.
          out.push(new ExternalHyperlink({
            link: n.href,
            children: [new TextRun({
              text: flatten(n.children),
              style: 'Hyperlink',
              ...(fmt.bold ? { bold: true } : {}),
              ...(fmt.italics ? { italics: true } : {}),
            })],
          }));
        }
        break;
    }
  }
  return out;
}

/**
 * A link's text as one string. Nested emphasis inside a link is flattened
 * rather than carried: `ExternalHyperlink` takes runs, and the formatting
 * that survives is the formatting the link itself sits in. Named in the
 * phase's residuals — the IR can express it and this renderer cannot.
 */
function flatten(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === 'text' ? n.v : flatten(n.children))).join('');
}

- [ ] **Step 5: Write the block switch**

Append:

```ts
const ALIGN = { l: AlignmentType.LEFT, r: AlignmentType.RIGHT, c: AlignmentType.CENTER } as const;

/** The usable text column, in DXA — what a full-width table spans. */
function columnDxa(theme: Theme): number {
  return dxa(PAGE_PT[theme.page.size].w - theme.page.marginPt * 2);
}

function table(b: Extract<Block, { t: 'table' }>, theme: Theme): Table {
  const cols = Math.max(b.head.length, ...b.rows.map((r) => r.length));
  const total = columnDxa(theme);
  // Equal columns, deliberately. The HTML renderer lets the browser lay the
  // table out; Word has no equivalent that is reproducible across versions,
  // and a width computed from the text would depend on font metrics this
  // renderer does not have. Named in the phase's residuals.
  const width = Math.floor(total / cols);
  const widths = Array.from({ length: cols }, (_, i) => (i === cols - 1 ? total - width * (cols - 1) : width));
  const cell = (content: Inline[] | undefined, i: number, head: boolean) =>
    new TableCell({
      width: { size: widths[i]!, type: WidthType.DXA },
      borders: {
        bottom: { style: BorderStyle.SINGLE, size: eighthPt(head ? 1 : 0.5), color: hex(theme.colors.rule) },
        top: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
      },
      children: [new Paragraph({
        style: head ? 'DocTableHeader' : 'DocTableCell',
        alignment: ALIGN[b.align[i] ?? 'l'],
        children: inline(content ?? [], {}, theme),
      })],
    });
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    borders: NO_BORDERS,
    rows: [
      new TableRow({ tableHeader: true, children: widths.map((_, i) => cell(b.head[i], i, true)) }),
      ...b.rows.map((row) => new TableRow({ children: widths.map((_, i) => cell(row[i], i, false)) })),
    ],
  });
}

function blocks(b: Block, theme: Theme): (Paragraph | Table)[] {
  switch (b.t) {
    case 'heading': {
      const style = (['DocH1', 'DocH2', 'DocH3'] as const)[b.level - 1]!;
      // outlineLevel is what puts a heading in Word's navigation pane; the
      // style alone does not, because the style id is ours and not Heading1.
      return [new Paragraph({ style, outlineLevel: b.level - 1, children: inline(b.text, {}, theme) })];
    }
    case 'para':
      return [new Paragraph({ style: 'DocBody', children: inline(b.text, {}, theme) })];
    case 'list': {
      const start = b.start ?? 1;
      return b.items.map((it, i) => new Paragraph({
        style: 'DocList',
        indent: { left: dxa(16 + b.depth * 14) },
        children: [
          // The marker is written, not generated. Word's numbering machinery
          // would restart at 1 for every fragment a nested list splits off,
          // and the IR's `start` is the thing that must survive — it is what a
          // reader checks when they look at item 4. Named in the residuals: in
          // Word this is text, not a list.
          new TextRun({ text: b.ordered ? `${start + i}. ` : '• ' }),
          ...inline(it, {}, theme),
        ],
      }));
    }
    case 'table': return [table(b, theme)];
    case 'code':
      // One paragraph per line: a single paragraph with soft breaks would
      // shade as one block in Word but wrap differently from the PDF.
      return b.text.split('\n').map((line) => new Paragraph({ style: 'DocCode', children: [new TextRun({ text: line })] }));
    case 'quote':
      return b.paras.map((p) => new Paragraph({ style: 'DocQuote', children: inline(p, {}, theme) }));
    case 'rule':
      return [new Paragraph({
        children: [],
        border: { bottom: { style: BorderStyle.SINGLE, size: eighthPt(0.75), color: hex(theme.colors.rule), space: 6 } },
        spacing: { before: dxa(7), after: dxa(7) },
      })];
    case 'pagebreak':
      return [new Paragraph({ children: [new PageBreak()] })];
    case 'image':
      // Task 7 replaces this with an embed for a raster data: URI. Everything
      // else stays exactly here.
      return [imagePlaceholder(b, theme)];
  }
}

/**
 * What a picture becomes when it cannot be embedded: a bordered box carrying
 * the alt text and where it pointed — the same shape the HTML renderer draws,
 * for the same reason. Nothing is silently lost.
 */
function imagePlaceholder(b: Extract<Block, { t: 'image' }>, theme: Theme): Paragraph {
  let where = '';
  try { where = new URL(b.src).host; } catch { /* a relative path has no host */ }
  if (where === '' && b.src.startsWith('data:')) where = b.src.slice(0, b.src.indexOf(',') + 1 || 20);
  return new Paragraph({
    style: 'DocPlaceholder',
    children: [new TextRun({ text: b.alt }), ...(where ? [new TextRun({ text: `  ${where}`, break: 1 })] : [])],
  });
}
```

- [ ] **Step 6: Assemble the document**

Append:

```ts
export async function renderDocx(doc: Doc, theme: Theme, opts: { epochSeconds: number }): Promise<Buffer> {
  const head: Paragraph[] = [
    new Paragraph({ style: 'DocTitle', children: [new TextRun({ text: doc.meta.title })] }),
    ...(doc.meta.subtitle ? [new Paragraph({ style: 'DocSubtitle', children: [new TextRun({ text: doc.meta.subtitle })] })] : []),
  ];

  const packed = await Packer.toBuffer(new Document({
    styles: styles(theme),
    // Ask Word to resolve PAGE and NUMPAGES when it opens the file; docx
    // writes the field instruction but no cached result.
    features: { updateFields: true },
    sections: [{
      properties: {
        titlePage: true,
        page: { margin: {
          top: dxa(theme.page.marginPt), right: dxa(theme.page.marginPt),
          bottom: dxa(theme.page.marginPt), left: dxa(theme.page.marginPt),
        } },
      },
      children: [...head, ...doc.blocks.flatMap((b) => blocks(b, theme))],
    }],
  }));

  return normalizeDocx(Buffer.from(packed), opts.epochSeconds);
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run test/render/docx.test.ts test/render/links.test.ts && npm run typecheck`
Expected: PASS. Where an option this plan did not have measured (`outlineLevel`, `indent`, `keepNext`, `break`, `tableHeader`) produces different XML than the test asserts, the test is the record of intent — read the emitted `word/document.xml` and fix the call, not the assertion, unless the emitted XML is genuinely equivalent.

- [ ] **Step 8: Commit**

```bash
git add src/render/docx.ts test/render/docx.test.ts test/render/links.test.ts
git commit -m "Render the IR to Word"
```

---

### Task 7: Embed a raster image, and refuse the rest loudly

**Files:**
- Modify: `src/render/docx.ts`
- Test: `test/render/docx.test.ts`

**Interfaces:**
- Consumes: `imagePlaceholder` and the `image` case from Task 6.
- Produces: no new exports. `renderDocx`'s behaviour for `{ t: 'image' }` changes.

- [ ] **Step 1: Write the failing tests**

Append to `test/render/docx.test.ts`:

```ts
// A 2×1 red PNG. Small enough to read in the diff, real enough to embed.
const PNG_2x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkS7cAAAAAElFTkSuQmCC';

describe('images', () => {
  it('embeds a raster data: URI as a real picture', async () => {
    const buf = await render(doc({ t: 'image', src: PNG_2x1, alt: 'a red bar' }));
    expect((await docxEntries(buf)).filter((n) => n.startsWith('word/media/'))).toHaveLength(1);
    expect(await docxPart(buf, 'word/document.xml')).toContain('<w:drawing>');
  });

  it('reads the picture’s own dimensions rather than guessing them', async () => {
    const xml = await docxPart(await render(doc({ t: 'image', src: PNG_2x1, alt: 'a' })), 'word/document.xml');
    // 2×1 pixels, so whatever the width, the height is half of it.
    const extent = xml.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
    expect(extent).not.toBeNull();
    expect(Number(extent![2])).toBe(Math.round(Number(extent![1]) / 2));
  });

  it('will not embed an SVG, and says so where the picture would have been', async () => {
    const svg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
    const xml = await docxPart(await render(doc({ t: 'image', src: svg, alt: 'a diagram' })), 'word/document.xml');
    expect(xml).not.toContain('<w:drawing>');
    expect(xml).toContain('a diagram');
    expect(xml).toContain('SVG');
  });

  it('turns a remote image into a placeholder naming its host', async () => {
    const xml = await docxPart(await render(doc({ t: 'image', src: 'https://cdn.example.com/x.png', alt: 'chart' })), 'word/document.xml');
    expect(xml).not.toContain('<w:drawing>');
    expect(xml).toContain('chart');
    expect(xml).toContain('cdn.example.com');
  });

  it('is still byte-identical twice with a picture in it', async () => {
    const d = doc({ t: 'image', src: PNG_2x1, alt: 'a' });
    expect((await render(d)).equals(await render(d))).toBe(true);
  });
});
```

Add `docxEntries` to the file's imports from `../helpers/docx-parts.js`.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run test/render/docx.test.ts -t images`
Expected: FAIL — every image takes the placeholder path today.

- [ ] **Step 3: Read a PNG's own size**

Append to `src/render/docx.ts`:

```ts
/**
 * A PNG's dimensions come from its IHDR chunk, which is always the first one:
 * an 8-byte signature, a 4-byte length, the type, then width and height as
 * big-endian 32-bit integers. Reading them is thirty bytes of arithmetic and
 * removes the alternative, which is to assume an aspect ratio and stretch
 * somebody's logo to fit it.
 */
function pngSize(bytes: Buffer): { w: number; h: number } {
  const signature = '89504e470d0a1a0a';
  if (bytes.subarray(0, 8).toString('hex') !== signature) throw new Error('not a PNG');
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

/** Word describes a picture in pixels at 96 dpi; the theme thinks in points. */
const px96 = (pt: number): number => (pt * 4) / 3;

const RASTER = /^data:image\/(png|jpeg|gif);base64,/;
```

- [ ] **Step 4: Embed what can be embedded**

Replace the `case 'image':` body in `blocks()` with:

```ts
    case 'image': {
      const raster = RASTER.exec(b.src);
      if (!raster) return [imagePlaceholder(b, theme)];
      const bytes = Buffer.from(b.src.slice(b.src.indexOf(',') + 1), 'base64');
      const type = raster[1] === 'jpeg' ? 'jpg' : (raster[1] as 'png' | 'gif');
      // Only a PNG's size is read directly; for the others the block must say
      // how wide it is, or there is nothing to scale from and the placeholder
      // is the honest answer.
      const natural = type === 'png' ? pngSize(bytes) : null;
      const widthPt = b.widthPt ?? (natural ? Math.min(PAGE_PT[theme.page.size].w - theme.page.marginPt * 2, natural.w * 0.75) : null);
      if (widthPt === null || natural === null) return [imagePlaceholder(b, theme)];
      const heightPt = (widthPt * natural.h) / natural.w;
      return [new Paragraph({
        children: [new ImageRun({ data: bytes, type, transformation: { width: px96(widthPt), height: px96(heightPt) } })],
        spacing: { after: dxa(8) },
      })];
    }
```

Add `ImageRun` to the `docx` import list. Then teach the placeholder to name an SVG for what it is, replacing the `data:` branch of `imagePlaceholder`:

```ts
  if (where === '' && b.src.startsWith('data:image/svg+xml')) {
    // Word's SVG support is version-dependent, and embedding one means
    // supplying a raster fallback beside it — which this renderer cannot
    // produce reproducibly. Saying so is better than a picture that is there
    // for some readers and missing for others.
    where = 'SVG not embedded';
  } else if (where === '' && b.src.startsWith('data:')) {
    where = b.src.slice(0, Math.max(b.src.indexOf(',') + 1, 20));
  }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/render/docx.test.ts && npm run typecheck`
Expected: PASS, including the byte-identity test — an image part is named after a SHA-1 of its own bytes, so it is stable by construction.

- [ ] **Step 6: Commit**

```bash
git add src/render/docx.ts test/render/docx.test.ts
git commit -m "Embed a raster in Word, and name what cannot be embedded"
```

---

### Task 8: The letterhead, in Word's own headers

**Files:**
- Modify: `src/render/docx.ts`
- Test: `test/render/docx.test.ts`

**Interfaces:**
- Consumes: `Theme.logo.png` (Task 1), `Theme.letterhead`; `styles()`, `columnDxa()`, `dxa()`, `eighthPt()`, `hex()`, `NO_BORDERS` (Task 6); `pngSize()` and `px96()` (Task 7 — do this task after that one).
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Append to `test/render/docx.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTheme } from '../../src/theme/resolve.js';

describe('the letterhead', () => {
  const branded = async () =>
    renderDocx(
      { meta: { title: 'Report', lang: 'en' }, blocks: [{ t: 'para', text: [{ t: 'text', v: 'x' }] }] },
      await loadTheme('tebin'),
      { epochSeconds: EPOCH },
    );

  it('puts the full letterhead on the first page and the slim one on the rest', async () => {
    const buf = await branded();
    // headers.default becomes header1.xml and headers.first becomes
    // header2.xml — the numbering follows the option order, not the page
    // order, so asserting this the other way round would pass for the wrong
    // reason.
    const first = await docxPart(buf, 'word/header2.xml');
    const running = await docxPart(buf, 'word/header1.xml');
    expect(first).toContain('TEBIN.PRO Sp. z o.o.');
    expect(first).toContain('NIP: 9552562516');
    expect(running).toContain('Report');
    expect(running).not.toContain('NIP');
  });

  it('counts the pages with Word’s own fields', async () => {
    const running = await docxPart(await branded(), 'word/header1.xml');
    expect(running).toContain('PAGE');
    expect(running).toContain('NUMPAGES');
  });

  it('draws the tick in the brand colour and the hairline in the rule colour', async () => {
    const first = await docxPart(await branded(), 'word/header2.xml');
    expect(first).toContain('w:color="DA291C"');
    expect(first).toContain(`w:sz="${8 * 3}"`);
    expect(first).toContain('w:color="CDCDCE"');
  });

  it('places the mark, at the height the theme asks for', async () => {
    const buf = await branded();
    expect(await docxPart(buf, 'word/header2.xml')).toContain('<w:drawing>');
    // 11pt tall → 11 * 4/3 px → EMU. The logo is wider than it is tall, so the
    // assertion is on the height, which the theme names outright.
    expect(await docxPart(buf, 'word/header2.xml')).toContain(`cy="${Math.round((11 * 4) / 3 * 9525)}"`);
  });

  it('prints a document’s own entity and date under the letterhead', async () => {
    const buf = await renderDocx(
      { meta: { title: 'R', lang: 'en', entity: 'TEBIN Limited', date: '2026-08-12' }, blocks: [] },
      await loadTheme('tebin'),
      { epochSeconds: EPOCH },
    );
    const first = await docxPart(buf, 'word/header2.xml');
    expect(first).toContain('TEBIN Limited');
    expect(first).toContain('2026-08-12');
  });

  it('prints a letterhead with no mark when the theme carries only a vector', async () => {
    const vectorOnly = resolveTheme({
      id: 'v', letterhead: ['Someone Ltd'],
      logo: { svg: '<svg><path class="c-brand" d="M0 0"/></svg>', heightPt: 11 },
    });
    const first = await docxPart(
      await renderDocx({ meta: { title: 'R', lang: 'en' }, blocks: [] }, vectorOnly, { epochSeconds: EPOCH }),
      'word/header2.xml',
    );
    expect(first).toContain('Someone Ltd');
    expect(first).not.toContain('<w:drawing>');
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run test/render/docx.test.ts -t letterhead`
Expected: FAIL — there are no header parts at all yet, so `docxPart` throws naming the parts that do exist.

- [ ] **Step 3: Build the two headers**

Append to `src/render/docx.ts`:

```ts
/**
 * The first page's letterhead. In the PDF this is drawn in the body flow,
 * because Chromium renders a header template in a separate context with none
 * of the page's CSS. Word has no such limitation, and a DOCX is a thing people
 * edit: a letterhead in the body flow is pushed down the page by the first
 * paragraph somebody adds, and page two carries nothing.
 *
 * The mark is the theme's raster. A PNG is not repainted by a class, so a
 * theme carrying only a vector prints the letterhead without one rather than
 * substituting a colour nobody chose.
 */
function firstPageHeader(doc: Doc, theme: Theme): Header {
  const total = columnDxa(theme);
  const logoWidth = dxa(120);
  const png = theme.logo?.png;
  const mark: ParagraphChild[] = [];
  if (png) {
    const bytes = Buffer.from(png.slice(png.indexOf(',') + 1), 'base64');
    const { w, h } = pngSize(bytes);
    const heightPt = theme.logo!.heightPt;
    mark.push(new ImageRun({
      data: bytes, type: 'png',
      transformation: { width: px96((heightPt * w) / h), height: px96(heightPt) },
    }));
  }

  const lines = theme.letterhead.map((l, i) =>
    new Paragraph({ style: i === 0 ? 'DocLetterheadName' : 'DocLetterheadLine', children: [new TextRun({ text: l })] }));
  // The document's own entity and date answer the same two questions the
  // letterhead does — who, and when — so they sit in the same muted column.
  const docLines = [doc.meta.entity, doc.meta.date]
    .filter((v): v is string => v !== undefined && v !== '')
    .map((v, i) => new Paragraph({
      style: 'DocLetterheadLine',
      spacing: i === 0 ? { before: dxa(5) } : {},
      children: [new TextRun({ text: v })],
    }));

  return new Header({
    children: [
      new Table({
        layout: TableLayoutType.FIXED,
        width: { size: total, type: WidthType.DXA },
        columnWidths: [logoWidth, total - logoWidth],
        borders: NO_BORDERS,
        rows: [new TableRow({ children: [
          new TableCell({ width: { size: logoWidth, type: WidthType.DXA }, borders: NO_BORDERS, children: [new Paragraph({ children: mark })] }),
          new TableCell({ width: { size: total - logoWidth, type: WidthType.DXA }, borders: NO_BORDERS, children: [...lines, ...docLines] }),
        ] })],
      }),
      tickRow(theme),
    ],
  });
}

/** The brand tick and the hairline beside it: 28pt of 3pt border, then 0.75pt
 *  across the rest. The same drawing the stylesheet makes, in Word's terms —
 *  nothing scales and it reads back as structure. */
function tickRow(theme: Theme): Table {
  const total = columnDxa(theme);
  const tick = dxa(28);
  const cell = (width: number, size: number, colour: string) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      borders: { ...NO_BORDERS, bottom: { style: BorderStyle.SINGLE, size: eighthPt(size), color: hex(colour) } },
      children: [new Paragraph({ children: [] })],
    });
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: total, type: WidthType.DXA },
    columnWidths: [tick, total - tick],
    borders: NO_BORDERS,
    rows: [new TableRow({ children: [
      cell(tick, 3, theme.colors.brandOnLight),
      cell(total - tick, 0.75, theme.colors.rule),
    ] })],
  });
}

/** Pages two onward: the title, and where the reader is. */
function runningHeader(doc: Doc, theme: Theme): Header {
  const total = columnDxa(theme);
  const right = dxa(60);
  const plain = (children: ParagraphChild[], alignment?: IParagraphOptions['alignment']) =>
    new Paragraph({ style: 'DocRunningHeader', ...(alignment ? { alignment } : {}), children });
  return new Header({
    children: [new Table({
      layout: TableLayoutType.FIXED,
      width: { size: total, type: WidthType.DXA },
      columnWidths: [total - right, right],
      borders: NO_BORDERS,
      rows: [new TableRow({ children: [
        new TableCell({ width: { size: total - right, type: WidthType.DXA }, borders: NO_BORDERS, children: [plain([new TextRun({ text: doc.meta.title })])] }),
        new TableCell({ width: { size: right, type: WidthType.DXA }, borders: NO_BORDERS, children: [plain([
          new TextRun({ children: [PageNumber.CURRENT] }),
          new TextRun({ text: ' / ' }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES] }),
        ], AlignmentType.RIGHT)] }),
      ] })],
    })],
  });
}
```

Add `Header` and `PageNumber` to the `docx` import list.

- [ ] **Step 4: Attach them to the section**

In `renderDocx`, add to the single section object, beside `properties` and `children`:

```ts
      headers: { default: runningHeader(doc, theme), first: firstPageHeader(doc, theme) },
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/render/docx.test.ts && npm run typecheck`
Expected: PASS, including the byte-identity tests — a header adds two parts, no randomness.

If `word/header2.xml` turns out to be the running header rather than the first-page one, the option order in step 4 was reversed relative to what the spike measured. Fix the code to match the spike, not the test.

- [ ] **Step 6: Commit**

```bash
git add src/render/docx.ts test/render/docx.test.ts
git commit -m "Give the Word document Word's own letterhead"
```

---

### Task 9: `--to docx`

**Files:**
- Modify: `src/cli/build.ts`
- Test: `test/cli/build.test.ts`

**Interfaces:**
- Consumes: `renderDocx` (Task 6).
- Produces: `documentor build x.md --to docx --theme tebin` writes `x.tebin.docx`.

- [ ] **Step 1: Write the failing tests**

Read `test/cli/build.test.ts` first and follow its existing shape (temporary directory, `runBuild`, the captured `io`). Add:

```ts
it('writes a Word document, named for the theme', async () => {
  const dir = await tmp('docx');
  const input = join(dir, 'report.md');
  await writeFile(input, '# Report\n\nHello.\n');
  const code = await runBuild([input, '--to', 'docx'], io);
  expect(code).toBe(0);
  expect(existsSync(join(dir, 'report.plain.docx'))).toBe(true);
});

it('produces identical Word bytes on two runs', async () => {
  const dir = await tmp('docx-twice');
  const input = join(dir, 'report.md');
  await writeFile(input, '# Report\n\nHello, [a link](https://example.com).\n');
  await runBuild([input, '--to', 'docx', '--out', join(dir, 'a')], io);
  await runBuild([input, '--to', 'docx', '--out', join(dir, 'b')], io);
  const [a, b] = await Promise.all([
    readFile(join(dir, 'a', 'report.plain.docx')),
    readFile(join(dir, 'b', 'report.plain.docx')),
  ]);
  expect(a.equals(b)).toBe(true);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run test/cli/build.test.ts`
Expected: FAIL — `cannot write "docx" yet`, exit code 2.

- [ ] **Step 3: Wire it in**

In `src/cli/build.ts`:

```ts
const FORMATS = new Set(['pdf', 'md', 'docx']); // xlsx arrives in phase 3
```

```ts
import { renderDocx } from '../render/docx.js';
```

and replace the ternary that picks the bytes:

```ts
    const bytes =
      format === 'pdf' ? await renderPdf(doc, theme, { epochSeconds })
      : format === 'docx' ? await renderDocx(doc, theme, { epochSeconds })
      : Buffer.from(renderMarkdown(doc), 'utf8');
```

Also update the usage line in the `build needs an input file` message to `[--to pdf,docx,md]`.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npm run typecheck`
Expected: PASS. `test/cli/exit-codes.test.ts` pins the usage text — if it asserts on the old `--to pdf,md`, update that expectation too.

- [ ] **Step 5: Commit**

```bash
git add src/cli/build.ts test/cli/
git commit -m "Let build write a Word document"
```

---

### Task 10: One agreement harness, three renderers

The phase-1 residuals note asked for this before a fourth renderer lands. DOCX is the instrument: it carries emphasis, cell boundaries and link targets as structure, which is exactly what the PDF cannot show.

**Files:**
- Create: `test/agreement/runs.ts`
- Create: `test/agreement/agree.test.ts`
- Modify: `test/baseline/kitchen-sink.test.ts` (remove the agreement half)

**Interfaces:**
- Consumes: `renderDocx`, `renderPdf`, `renderMarkdown`, `docxPart`.
- Produces: nothing later tasks import — this is the last test task.

- [ ] **Step 1: Move the existing harness**

Create `test/agreement/runs.ts` and move into it, unchanged, from `test/baseline/kitchen-sink.test.ts`: the `Run` type, `norm`, `unmark`, `runsFromMarkdown`, `classify` and `expectSameSequence`. Export each. Change nothing about them in this step — a move and a behaviour change in one commit is a move nobody can review.

Create `test/agreement/agree.test.ts` and move the `describe('the renderers agree', …)` block into it, importing what it needs from `./runs.js`. Delete that block from `test/baseline/kitchen-sink.test.ts`, leaving the baseline image, the page count, the header-collision and the round-trip tests where they are.

Run: `npx vitest run test/agreement/ test/baseline/`
Expected: PASS, with exactly the same tests passing as before the move.

Commit this step on its own:

```bash
git add test/agreement/ test/baseline/kitchen-sink.test.ts
git commit -m "Move the agreement comparison out of the baseline file"
```

- [ ] **Step 2: Write the failing tests for the third renderer**

Append to `test/agreement/agree.test.ts`, adding these to its imports:

```ts
import { renderDocx } from '../../src/render/docx.js';
import { docxPart } from '../helpers/docx-parts.js';
import {
  boldRunsFromDocx, cellsFromDocx, emphasisFromIr, flattenInline, headingsFromDocx,
  italicRunsFromDocx, linkTargetsFromIr, linkTargetsFromRels,
} from './runs.js';
```

```ts
describe('Word says what the others say', () => {
  it('carries every heading, in order and at its level', async () => {
    const { doc } = ingestMarkdown(source);
    const xml = await docxPart(await renderDocx(doc, await loadTheme('plain'), { epochSeconds: EPOCH }), 'word/document.xml');
    const fromDocx = headingsFromDocx(xml);
    const fromMd = runsFromMarkdown(renderMarkdown(doc))
      .filter((r) => r.kind.startsWith('heading'))
      .map((r) => `h${r.kind.slice(-1)} ${r.text}`);
    expectSameSequence('heading', fromMd, fromDocx);
  });

  it('puts each table value in its own cell, which the PDF cannot show', async () => {
    // The PDF comparison flattens a table to a sequence of words because an
    // untagged PDF has no cell boundaries to read. Word has <w:tc>, so this is
    // the renderer that can catch a value landing in the wrong column with the
    // reading order unchanged.
    const { doc } = ingestMarkdown(source);
    const xml = await docxPart(await renderDocx(doc, await loadTheme('plain'), { epochSeconds: EPOCH }), 'word/document.xml');
    const table = doc.blocks.find((b) => b.t === 'table');
    expect(table).toBeDefined();
    const expected = [
      ...table!.head.map(flattenInline),
      ...table!.rows.flatMap((r) => r.map(flattenInline)),
    ];
    expectSameSequence('table cell', expected, cellsFromDocx(xml));
  });

  it('carries the emphasis the IR asked for, which the PDF cannot show', async () => {
    // Compared against the IR rather than against Markdown: the IR is the
    // contract a renderer is meant to honour, and PDF text extraction reports
    // no weight or style at all, so there is no third opinion to reconcile.
    const { doc } = ingestMarkdown(source);
    const xml = await docxPart(await renderDocx(doc, await loadTheme('plain'), { epochSeconds: EPOCH }), 'word/document.xml');
    expectSameSequence('bold run', emphasisFromIr(doc, 'strong'), boldRunsFromDocx(xml));
    expectSameSequence('italic run', emphasisFromIr(doc, 'em'), italicRunsFromDocx(xml));
  });

  it('points every link where the IR points it, which the PDF cannot show', async () => {
    const { doc } = ingestMarkdown(source);
    const buf = await renderDocx(doc, await loadTheme('plain'), { epochSeconds: EPOCH });
    const rels = await docxPart(buf, 'word/_rels/document.xml.rels');
    expectSameSequence('link target', linkTargetsFromIr(doc), linkTargetsFromRels(rels));
  });
});
```

- [ ] **Step 3: Write the extractors**

Append to `test/agreement/runs.ts`:

```ts
// Reading Word back. These are deliberately regexes over the part rather than
// an XML parse: what is being checked is a handful of specific elements, and a
// parser would add a dependency and a second thing to be wrong about. Note
// that <w:t> is always emitted as <w:t xml:space="preserve">, so a pattern
// matching a bare <w:t> finds nothing.

const TEXT = /<w:t[^>]*>([^<]*)<\/w:t>/g;

const textOf = (xml: string): string =>
  [...xml.matchAll(TEXT)].map((m) => m[1] ?? '').join('');

/** Every <w:p> in the part, with its style id if it has one. */
function paragraphs(xml: string): { style: string; xml: string }[] {
  return [...xml.matchAll(/<w:p(?: [^>]*)?>([\s\S]*?)<\/w:p>/g)].map((m) => ({
    style: m[1]?.match(/<w:pStyle w:val="([^"]+)"\/>/)?.[1] ?? '',
    xml: m[1] ?? '',
  }));
}

export function headingsFromDocx(xml: string): string[] {
  return paragraphs(xml)
    .filter((p) => /^DocH[123]$/.test(p.style))
    .map((p) => `h${p.style.slice(-1)} ${norm(textOf(p.xml))}`);
}

export function cellsFromDocx(xml: string): string[] {
  return [...xml.matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map((m) => norm(textOf(m[1] ?? '')));
}

function runsWith(xml: string, mark: string): string[] {
  return [...xml.matchAll(/<w:r>([\s\S]*?)<\/w:r>/g)]
    .filter((m) => (m[1] ?? '').includes(mark))
    .map((m) => norm(textOf(m[1] ?? '')))
    .filter((t) => t !== '');
}

export const boldRunsFromDocx = (xml: string): string[] => runsWith(xml, '<w:b/>');
export const italicRunsFromDocx = (xml: string): string[] => runsWith(xml, '<w:i/>');

export function linkTargetsFromRels(rels: string): string[] {
  return [...rels.matchAll(/Target="([^"]+)" TargetMode="External"/g)].map((m) => m[1]!);
}

// The IR side of the two comparisons above. Flattening an inline tree to its
// text is the same operation every renderer performs, so it belongs here once.

export function flattenInline(nodes: Inline[]): string {
  return norm(nodes.map((n) => (n.t === 'text' ? n.v : flattenInline(n.children))).join(''));
}

export function emphasisFromIr(doc: Doc, kind: 'strong' | 'em'): string[] {
  const out: string[] = [];
  const walk = (nodes: Inline[]): void => {
    for (const n of nodes) {
      if (n.t === 'text') continue;
      if (n.t === kind) out.push(flattenInline(n.children));
      walk(n.children);
    }
  };
  for (const b of doc.blocks) walk(inlinesOf(b));
  return out;
}

export function linkTargetsFromIr(doc: Doc): string[] {
  const out: string[] = [];
  const walk = (nodes: Inline[]): void => {
    for (const n of nodes) {
      if (n.t === 'text') continue;
      if (n.t === 'link' && !schemeIsRefused(n.href)) out.push(n.href);
      walk(n.children);
    }
  };
  for (const b of doc.blocks) walk(inlinesOf(b));
  return out;
}

/** Every inline sequence a block carries, in reading order. */
function inlinesOf(b: Block): Inline[] {
  switch (b.t) {
    case 'heading': case 'para': return b.text;
    case 'list': return b.items.flat();
    case 'table': return [...b.head.flat(), ...b.rows.flat().flat()];
    case 'quote': return b.paras.flat();
    case 'code': case 'rule': case 'pagebreak': case 'image': return [];
  }
}
```

Import `Block`, `Doc`, `Inline` from `../../src/ir/types.js` and `schemeIsRefused` from `../../src/render/links.js` at the top of the file.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/agreement/`
Expected: PASS. A failure here is a real disagreement — read the message, which names the item and both sides, before changing anything.

- [ ] **Step 5: Run everything**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add test/agreement/
git commit -m "Compare Word against the others on what only Word can show"
```

---

### Task 11: Say what phase 2 left open

**Files:**
- Create: `docs/superpowers/notes/2026-08-12-phase-2-residuals.md`
- Modify: `docs/superpowers/notes/2026-08-12-phase-1-residuals.md`
- Modify: `README.md`
- Modify: `docs/superpowers/notes/2026-08-12-docx-spike.md` (commit it)

**Interfaces:** none.

- [ ] **Step 1: Update the phase-1 note**

In `docs/superpowers/notes/2026-08-12-phase-1-residuals.md`, mark the agreement-test blind spots that DOCX closed — inline emphasis, table cell boundaries, link targets — as closed, naming `test/agreement/`, in the same struck-through style the two link findings already use. Leave the ones that are still open alone.

- [ ] **Step 2: Write the phase-2 note**

Create `docs/superpowers/notes/2026-08-12-phase-2-residuals.md`, following the shape of the phase-1 note. It must carry at least these, each with its reason:

- **A Word list is text, not a list.** `src/render/docx.ts` writes the marker itself, because Word's numbering restarts at 1 for every fragment a nested list splits off and the IR's `start` is the thing that has to survive. The cost is that a reader cannot continue the list by pressing Enter.
- **Word tables have equal columns.** The HTML renderer lets the browser lay a table out; no Word equivalent is reproducible across versions, and a width computed from the text needs font metrics this renderer does not have.
- **No visual baseline for DOCX.** Word cannot be driven headlessly here, and rasterising through a converter would test the converter.
- **The duplicate-`w:styleId` question is answered by avoidance, not by measurement.** Distinct ids sidestep it; whether other readers tolerate the collision was not measured, and LibreOffice is not installed here.
- **`theme.logo.png` does not follow the theme.** A raster is not repainted by a class.
- **Emphasis inside a link is flattened in Word.** `ExternalHyperlink` takes runs, and the renderer passes the link's text as one; the IR can express `[**bold** link](…)` and this renderer cannot. The kitchen-sink fixture has no such link today; the moment one is added, the agreement test's emphasis comparison fails, because it compares Word's bold runs against the IR's. That is the right outcome — it is a limitation that announces itself rather than a silent loss.
- Anything the implementation turned up that this plan did not predict.

- [ ] **Step 3: Update the README**

Add Word to the formats the README lists, a line on `--to docx`, and a short section on refreshing the brand snapshot that points at `brand/tebin/SOURCE.md`. If the README claims a format is unimplemented, fix that claim.

- [ ] **Step 4: Run everything one last time**

Run: `npx vitest run && npm run typecheck && npm run build`
Expected: PASS, and `dist/` builds. Then `npm audit --omit=dev` and record the result in the phase-2 note if it is no longer zero.

- [ ] **Step 5: Commit**

```bash
git add docs README.md
git commit -m "Record what phase 2 left open, and why"
```
