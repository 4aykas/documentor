import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGE_NAME, bundledThemeIds } from '../../src/theme/resolve.js';

// What an installed copy contains is decided by package.json alone, and it is
// the one thing the whole suite cannot see: every other test runs against the
// working tree, where dist/, themes/ and src/ are all present regardless of
// what would actually be shipped.
//
// That gap shipped a real defect. dist/ is gitignored and no lifecycle script
// built it, so installing this repo from a git URL produced a package holding
// themes, a README and a manifest whose `bin` pointed at a file that was not
// there. Every test passed. Installing it was the only thing that showed it.
//
// These checks are the cheap standing half of that: they derive what must be
// shipped from the code that reads it at runtime, so a rename or a dropped
// script fails here instead of in someone else's node_modules.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  name: string;
  bin: Record<string, string>;
  files: string[];
  scripts: Record<string, string>;
};

/** The top-level name an `npm publish` would ship a path under, or undefined. */
function shippedUnder(path: string): string | undefined {
  const head = path.replace(/^\.\//, '').split('/')[0];
  return pkg.files.find((f) => f.replace(/\/$/, '') === head);
}

describe('what an installed copy contains', () => {
  it('ships every file `bin` points at', () => {
    for (const [command, target] of Object.entries(pkg.bin)) {
      expect(shippedUnder(target), `bin.${command} → ${target} is not under any "files" entry`).toBeDefined();
    }
  });

  it('ships the themes the resolver reads at runtime', () => {
    // src/theme/resolve.ts turns a bare theme id into
    // <package root>/themes/<id>/theme.json, so a package without themes/ can
    // load no built-in theme at all — including the default.
    expect(shippedUnder('themes/plain/theme.json')).toBeDefined();

    // And each id a user can pass must actually be in there, not just the one
    // the default happens to use. The list comes from the resolver's own
    // enumeration, so a theme added to themes/ is covered without anyone
    // remembering this test exists.
    const ids = bundledThemeIds();
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(shippedUnder(`themes/${id}/theme.json`)).toBeDefined();
    }
  });

  it('agrees with the name the theme resolver looks for', () => {
    // The resolver walks up to the first ancestor whose package.json declares
    // this exact name. Rename one without the other and every bare theme id
    // stops resolving, but only in an installed copy.
    expect(pkg.name).toBe(PACKAGE_NAME);
  });

  it('builds from an empty dist, so a deleted module stops shipping', () => {
    // tsc writes over dist/ and never clears it, so a file deleted from src/
    // keeps its compiled copy there forever — and `files: ["dist"]` ships the
    // whole directory. Found by reading `npm pack --dry-run` after deleting
    // src/render/normalize-pdf.ts: the tarball still carried its .js, .d.ts
    // and .js.map. Nothing in the working tree shows this; the only place it
    // appears is the tarball, and by then it is published.
    expect(
      pkg.scripts['build'],
      'the build must clear dist/ first, or a deleted source file keeps shipping',
    ).toMatch(/\brm\b|rmSync|rimraf|del\b/);
  });

  it('ships the example template the README points readers at', () => {
    // README.md is itself shipped (see `files` above) and tells the reader
    // that templates/offer.example.md is a generic example to copy from.
    // Derive the path from the README's own words rather than hardcoding
    // it a second time, so a renamed example fails here instead of leaving
    // a shipped README pointing at nothing.
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    // Every templates/ file the README names, not just the first: there is
    // more than one example now, and checking only the first would let a
    // later one ship broken.
    const referenced = [...readme.matchAll(/`(templates\/[\w.-]+)`/g)].map((m) => m[1]!);
    expect(referenced.length, 'README.md no longer names a templates/ example file').toBeGreaterThan(0);
    for (const path of new Set(referenced)) {
      expect(shippedUnder(path), `README.md references ${path}, which is not under any "files" entry`).toBeDefined();
      expect(existsSync(join(ROOT, path)), `README.md references ${path}, which does not exist`).toBe(true);
    }
  });

  it('points readers at nothing that stays behind in the repository', () => {
    // README.md ships. A path it offers as an example therefore has to be in
    // the package, and `test/` never is — it is not under any `files` entry.
    // Caught for real: the README pointed at
    // `test/fixtures/cover-example.proposal.json` as the data file to look
    // at, and only installing the tarball into an empty directory showed
    // that a reader could not open it. The example data now lives beside the
    // template it drives, under `templates/`, where the rule above already
    // requires it to ship.
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    const stranded = [...readme.matchAll(/`(test\/[\w./-]+)`/g)].map((m) => m[1]!);
    expect(stranded, 'README.md names a test/ path, which does not ship').toEqual([]);
  });

  it('builds before npm can pack or publish it', () => {
    // dist/ is gitignored, so the build has to happen inside npm's own
    // lifecycle — a human remembering to run it first is exactly the step that
    // failed. `prepare` covers git-URL installs as well as pack and publish;
    // `prepack` covers pack and publish only. Either satisfies this.
    const builds = ['prepare', 'prepack'].some((s) => pkg.scripts[s]?.includes('build'));
    expect(builds, 'neither prepare nor prepack runs the build').toBe(true);
  });
});

// The same gap, one level down: a package the code imports at runtime but
// package.json lists only under devDependencies is present in this working
// tree and in CI, and missing from every installed copy. pdfjs-dist shipped
// that way — `npm install github:4aykas/documentor` produced a CLI that could
// not start, since every command loads the PDF reader.
describe('what an installed copy can import', () => {
  const deps = new Set(Object.keys((pkg as unknown as { dependencies?: Record<string, string> }).dependencies ?? {}));
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []);
  const packageOf = (spec: string) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!);

  it('declares every package src imports at runtime as a dependency, not a devDependency', () => {
    const missing = new Set<string>();
    for (const file of files(join(ROOT, 'src'))) {
      const code = readFileSync(file, 'utf8');
      // Value imports only: `import type` is erased by tsc and never loaded.
      const specs = [
        ...code.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+'([^'.][^']*)'/gm),
        ...code.matchAll(/\bimport\(\s*'([^'.][^']*)'\s*\)/g),
      ].map((m) => m[1]!);
      for (const spec of specs) {
        if (spec.startsWith('node:')) continue;
        if (!deps.has(packageOf(spec))) missing.add(`${packageOf(spec)} (imported by ${file.slice(ROOT.length)})`);
      }
    }
    expect([...missing], 'imported at runtime but not in "dependencies"').toEqual([]);
  });
});
