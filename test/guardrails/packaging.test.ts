import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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

  it('builds before npm can pack or publish it', () => {
    // dist/ is gitignored, so the build has to happen inside npm's own
    // lifecycle — a human remembering to run it first is exactly the step that
    // failed. `prepare` covers git-URL installs as well as pack and publish;
    // `prepack` covers pack and publish only. Either satisfies this.
    const builds = ['prepare', 'prepack'].some((s) => pkg.scripts[s]?.includes('build'));
    expect(builds, 'neither prepare nor prepack runs the build').toBe(true);
  });
});
