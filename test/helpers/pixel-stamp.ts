// Where the pixel baselines were approved. Their bytes are a property of one
// platform and one Chromium build (see test/baseline/local-only-pixels.test.ts),
// so the approval records both, and a run anywhere else says so in one line
// instead of failing every image: on 2026-10-17 all eleven failed for six
// days, approved on Linux and run on Windows, and nothing said why.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { Browser } from 'playwright-core';

export type PixelStamp = { platform: string; arch: string; chromium: string };
export type Approval = PixelStamp & { approved: string; images: string[] };

export const stampOf = (browser: Browser): PixelStamp => ({ platform: process.platform, arch: process.arch, chromium: browser.version() });

export async function readApproval(file: string): Promise<Approval | null> {
  return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) as Approval : null;
}

export async function writeApproval(file: string, a: Approval): Promise<void> {
  await writeFile(file, `${JSON.stringify(a, null, 2)}\n`);
}

export const describeStamp = (s: PixelStamp): string => `${s.platform}-${s.arch}, Chromium ${s.chromium}`;

/** Null when `here` is where the baselines were approved; else what to do. */
export function stampMismatch(here: PixelStamp, approved: Approval | null): string | null {
  if (approved !== null && approved.platform === here.platform && approved.arch === here.arch && approved.chromium === here.chromium) return null;
  const was = approved === null ? 'with no record of where' : `on ${describeStamp(approved)} (${approved.approved})`;
  return `the pixel baselines were approved ${was}; this is ${describeStamp(here)}, so their bytes cannot match. `
    + 'The fresh images are in test/baseline/__actual__: look at them against the baselines '
    + '(npm run pixels:diff -- test/baseline/__baseline__ test/baseline/__actual__ --strip <png>), and when they are right, npm run pixels:approve.';
}
