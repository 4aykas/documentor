import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { staleBuild } from '../../src/cli/preflight.js';

// fileURLToPath decodes percent-escapes (e.g. a repo path containing spaces),
// unlike a plain `.pathname` read — see test/baseline/kitchen-sink.test.ts.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ENTRY = join(ROOT, 'dist', 'bin', 'documentor.js');

// `npm run build` is slow, so this suite does not run it — it asserts against
// whatever is already built and skips otherwise. CI builds before testing, so
// there the skip never fires; locally it keeps a fast watch loop fast.
// A dist/ older than src/ is yesterday's code: it would fail or pass for
// reasons that are not the source's (a dist built before haskoning became
// marine failed here on 2026-10-17). It is skipped, saying why; CI builds
// first, so there it always runs.
const STALE = existsSync(ENTRY) ? staleBuild(ENTRY) : undefined;
if (STALE !== undefined) console.warn(`dist-smoke skipped: ${STALE}`);

describe.skipIf(!existsSync(ENTRY) || STALE !== undefined)('the built CLI', () => {
  it('loads its own bundled theme and reports itself ready', () => {
    const out = execFileSync(process.execPath, [ENTRY, 'doctor'], { encoding: 'utf8' });
    expect(out).toMatch(/^ok\s+Theme/m);
  });
});
