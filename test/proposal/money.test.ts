import { describe, expect, it } from 'vitest';
import { formatMoney, toCents } from '../../src/proposal/money.js';

// NBSP ( ), not a plain space: an amount must not wrap mid-figure, and the
// corpus prints "€ 4 500,00" as one visual token.
const NB = ' ';

describe('toCents', () => {
  it('converts whole euros and two-decimal euros exactly', () => {
    expect(toCents(45, 'team[0].rate')).toBe(4500);
    expect(toCents(45.5, 'x')).toBe(4550);
    expect(toCents(0.01, 'x')).toBe(1);
    expect(toCents(88000, 'x')).toBe(8800000);
  });
  it('refuses more than two decimals, naming the field', () => {
    expect(() => toCents(45.555, 'team[0].rate')).toThrow(/team\[0\]\.rate/);
    expect(() => toCents(45.555, 'team[0].rate')).toThrow(/two decimals/);
  });
  it('refuses negatives and non-numbers, naming the field', () => {
    expect(() => toCents(-1, 'p')).toThrow(/p/);
    expect(() => toCents('45' as unknown, 'p')).toThrow(/number/);
    expect(() => toCents(Number.NaN, 'p')).toThrow(/p/);
  });
});

describe('formatMoney', () => {
  it('formats every digit-group size', () => {
    expect(formatMoney(0, 'EUR')).toBe(`€${NB}0,00`);
    expect(formatMoney(4500, 'EUR')).toBe(`€${NB}45,00`);
    expect(formatMoney(90000, 'EUR')).toBe(`€${NB}900,00`);
    expect(formatMoney(450000, 'EUR')).toBe(`€${NB}4${NB}500,00`);
    expect(formatMoney(8800000, 'EUR')).toBe(`€${NB}88${NB}000,00`);
    expect(formatMoney(123456789, 'EUR')).toBe(`€${NB}1${NB}234${NB}567,89`);
  });
  it('keeps the cents column two digits wide', () => {
    expect(formatMoney(4505, 'EUR')).toBe(`€${NB}45,05`);
    expect(formatMoney(4550, 'EUR')).toBe(`€${NB}45,50`);
  });
});