import { stat } from 'node:fs/promises';

/**
 * The build's notion of "now". Never Date.now(): a timestamp read from the
 * clock is the one thing that would make output non-reproducible, and it would
 * do so silently.
 */
export async function resolveEpoch(env: NodeJS.ProcessEnv, inputPath: string): Promise<number> {
  const raw = env['SOURCE_DATE_EPOCH'];
  if (raw !== undefined && raw !== '') {
    if (!/^\d+$/.test(raw)) {
      throw new Error(`SOURCE_DATE_EPOCH must be a non-negative integer number of seconds, got ${JSON.stringify(raw)}`);
    }
    return Number(raw);
  }
  const epoch = Math.floor((await stat(inputPath)).mtimeMs / 1000);
  // Every renderer throws on a negative epoch, and a file can genuinely
  // carry a pre-1970 mtime (a bad backup restore, a mis-set clock at write
  // time, FAT's own quirks). Crashing `build` on that file with no clue that
  // its *timestamp* is the culprit is worse than clamping: 1970-01-01 is a
  // deliberately-wrong-looking but harmless stand-in, and SOURCE_DATE_EPOCH
  // remains the way to give the real intended date when that placeholder
  // isn't good enough.
  return Math.max(0, epoch);
}
