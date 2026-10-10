import { describe, expect, it } from 'vitest';
import { parseProofArgs } from '../../src/cli/proof.js';

describe('proof arguments', () => {
  it('takes a PDF and defaults to four columns of 360 px', () => {
    expect(parseProofArgs(['a.pdf'])).toEqual({ input: 'a.pdf', cols: 4, width: 360 });
  });

  it('reads --out, --cols and --width, and refuses what it does not know', () => {
    expect(parseProofArgs(['a.pdf', '--cols', '5', '--width', '240', '--out', 's.png'])).toEqual({ input: 'a.pdf', out: 's.png', cols: 5, width: 240 });
    expect(() => parseProofArgs(['a.pdf', '--cols', '0'])).toThrow(/--cols takes a whole number from 1 to 12/);
    expect(() => parseProofArgs(['a.pdf', '--dpi', '300'])).toThrow(/unknown option --dpi/);
    expect(() => parseProofArgs(['a.pdf', 'b.pdf'])).toThrow(/unexpected argument/);
  });
});
