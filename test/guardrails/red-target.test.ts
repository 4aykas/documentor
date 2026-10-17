import { describe, expect, it } from 'vitest';
import { refuseNegative } from '../fixtures/red-target.js';

// The guard npm run red is tested against (red.test.ts). It runs only when
// that test asks for it, so the moment its target is mutated, no other run
// of the suite can see it fail.
describe.runIf(process.env['RED_TARGET'] === '1')('the red target', () => {
  it('refuses a negative number', () => {
    expect(refuseNegative(-1)).toBe(true);
    expect(refuseNegative(1)).toBe(false);
  });
});
