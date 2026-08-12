import { describe, expect, it } from 'vitest';
import { normalizePdfDates } from '../../src/render/normalize-pdf.js';

const sample = (stamp: string) =>
  Buffer.from(
    `%PDF-1.4\n<</CreationDate (D:${stamp}+00'00')\n/ModDate (D:${stamp}+00'00')>>\ntrailer\n`,
    'latin1',
  );

describe('normalizePdfDates', () => {
  it('rewrites both date fields to the given epoch', () => {
    const out = normalizePdfDates(sample('20260811233915'), 1_000_000_000).toString('latin1');
    expect(out).toContain("/CreationDate (D:20010909014640+00'00')");
    expect(out).toContain("/ModDate (D:20010909014640+00'00')");
  });

  it('does not change the byte length, so xref offsets stay valid', () => {
    const input = sample('20260811233915');
    expect(normalizePdfDates(input, 1_000_000_000).length).toBe(input.length);
  });

  it('is idempotent', () => {
    const once = normalizePdfDates(sample('20260811233915'), 1_000_000_000);
    expect(normalizePdfDates(once, 1_000_000_000).equals(once)).toBe(true);
  });

  it('leaves a buffer with no date fields untouched', () => {
    const input = Buffer.from('%PDF-1.4\nno dates here\n', 'latin1');
    expect(normalizePdfDates(input, 1_000_000_000).equals(input)).toBe(true);
  });

  it('refuses an epoch it cannot render in fourteen digits', () => {
    expect(() => normalizePdfDates(sample('20260811233915'), -1)).toThrow(/epoch/);
  });

  it('refuses an epoch past the representable Date range', () => {
    // ~8.64e12s is roughly the upper bound of what `new Date` can represent;
    // beyond it getTime() is NaN and, unguarded, every String(NaN) field
    // still produces a fourteen-character-looking stamp made of "NaN"s that
    // is actually the wrong width once padStart is accounted for.
    expect(() => normalizePdfDates(sample('20260811233915'), 1e13)).toThrow(/epoch/);
  });

  it('refuses a non-integer epoch', () => {
    expect(() => normalizePdfDates(sample('20260811233915'), 1_000_000_000.5)).toThrow(/epoch/);
  });

  it('never changes the byte length, for every epoch it accepts', () => {
    // The one-happy-path length check above is a spot check; this is the
    // property itself, stated directly rather than inferred from a single
    // epoch. If any accepted epoch ever produced a stamp of the wrong width,
    // every xref offset after it would be silently wrong.
    for (const epoch of [0, 1, 59, 1_000_000_000, 4_102_444_800, 253_402_300_799]) {
      const input = sample('20260811233915');
      expect(normalizePdfDates(input, epoch).length).toBe(input.length);
    }
  });
});
