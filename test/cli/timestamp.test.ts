import { describe, expect, it } from 'vitest';
import { mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveEpoch } from '../../src/cli/timestamp.js';

async function fileWithMtime(epoch: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'documentor-ts-'));
  const file = join(dir, 'a.md');
  await writeFile(file, '# x\n');
  await utimes(file, epoch, epoch);
  return file;
}

describe('resolveEpoch', () => {
  it('prefers SOURCE_DATE_EPOCH', async () => {
    const file = await fileWithMtime(1_600_000_000);
    expect(await resolveEpoch({ SOURCE_DATE_EPOCH: '1000000000' }, file)).toBe(1_000_000_000);
  });

  it("falls back to the input file's mtime", async () => {
    const file = await fileWithMtime(1_600_000_000);
    expect(await resolveEpoch({}, file)).toBe(1_600_000_000);
  });

  it('rejects a SOURCE_DATE_EPOCH that is not a non-negative integer', async () => {
    const file = await fileWithMtime(1_600_000_000);
    await expect(resolveEpoch({ SOURCE_DATE_EPOCH: 'yesterday' }, file)).rejects.toThrow(/SOURCE_DATE_EPOCH/);
    await expect(resolveEpoch({ SOURCE_DATE_EPOCH: '-5' }, file)).rejects.toThrow(/SOURCE_DATE_EPOCH/);
  });
});
