import { describe, expect, it } from 'vitest';
import { mixToWhite, stepOf, weekLabel, SCALE_STEPS } from '../../src/render/tint.js';

describe('stepOf', () => {
  it('maps zero to the empty step and the maximum to the top step', () => {
    expect(stepOf(0, 16, 4)).toBe(0);
    expect(stepOf(16, 16, 4)).toBe(4);
  });
  it('spreads intermediate values across the steps by ceiling', () => {
    expect(stepOf(1, 16, 4)).toBe(1);
    expect(stepOf(4, 16, 4)).toBe(1);
    expect(stepOf(5, 16, 4)).toBe(2);
    expect(stepOf(8, 16, 4)).toBe(2);
    expect(stepOf(12, 16, 4)).toBe(3);
    expect(stepOf(13, 16, 4)).toBe(4);
  });
  it('survives a zero maximum without dividing by it', () => {
    expect(stepOf(0, 0, 4)).toBe(0);
  });
});

describe('mixToWhite', () => {
  it('is the identity at t=1 and white at t=0', () => {
    expect(mixToWhite('#DA291C', 1)).toBe('#DA291C');
    expect(mixToWhite('#DA291C', 0)).toBe('#FFFFFF');
  });
  it('blends per channel with rounding, deterministically', () => {
    // 0xDA=218 → 218*0.32 + 255*0.68 = 243.16 → 243 = F3
    // 0x29=41  → 41*0.32 + 255*0.68  = 186.52 → 187 = BB
    // 0x1C=28  → 28*0.32 + 255*0.68  = 182.36 → 182 = B6
    expect(mixToWhite('#DA291C', 0.32)).toBe('#F3BBB6');
  });
  it('exposes the same steps every renderer uses', () => {
    expect(SCALE_STEPS).toEqual([0.18, 0.32, 0.6, 1]);
  });
});

describe('weekLabel', () => {
  it('pads to two digits and grows past 99 without truncating', () => {
    expect(weekLabel(0)).toBe('W01');
    expect(weekLabel(15)).toBe('W16');
    expect(weekLabel(99)).toBe('W100');
  });
});
