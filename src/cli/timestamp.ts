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
  return Math.floor((await stat(inputPath)).mtimeMs / 1000);
}
