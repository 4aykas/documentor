import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath decodes percent-escapes (e.g. a repo path containing spaces),
// unlike a plain `.pathname` read — see test/baseline/kitchen-sink.test.ts.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ENTRY = join(ROOT, 'dist', 'bin', 'documentor.js');

// `npm run build` is slow, so this suite does not run it — it asserts against
// whatever is already built and skips otherwise. CI builds before testing, so
// there the skip never fires; locally it keeps a fast watch loop fast.
describe.skipIf(!existsSync(ENTRY))('the built CLI', () => {
  it('loads its own bundled theme and reports itself ready', () => {
    const out = execFileSync(process.execPath, [ENTRY, 'doctor'], { encoding: 'utf8' });
    expect(out).toMatch(/^ok\s+Theme/m);
  });
});
