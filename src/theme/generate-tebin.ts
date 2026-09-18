// `npm run theme:tebin`. Reads only brand/tebin/ and writes only
// themes/<entity>/theme.json — no network, so it runs in an offline CI, and
// each snapshot's diff is the record of what the brand changed.
//
// It writes every entity's theme in one run rather than offering a script per
// entity: they share one brand snapshot, so regenerating one and forgetting
// the other is the only way they could ever disagree about a colour.
//
// The recipe itself lives in tebin.ts, because the test that guards these
// files against hand-edits has to use the same one.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEBIN_ENTITIES, tebinThemeJson } from './tebin.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

for (const entity of TEBIN_ENTITIES) {
  const out = await tebinThemeJson(join(ROOT, 'brand', 'tebin'), entity);
  const target = join(ROOT, 'themes', entity.id, 'theme.json');
  // themes/<entity>/ does not exist until the first run.
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, out, 'utf8');
  process.stdout.write(`wrote ${target}\n`);
}
