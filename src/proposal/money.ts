// Money for proposals. Integer cents everywhere past this boundary: the one
// place "almost right" reliably looks right is a price, so no float survives
// into any arithmetic that a reader will check against their own.

const NB = ' '; // an amount must not wrap mid-figure

/**
 * Euros as JSON wrote them → integer cents. Two decimals at most: a rate of
 * 45.555 is not a price anyone quoted, it is a mistake, and rounding it
 * silently would print a figure nobody wrote.
 */
export function toCents(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${where}: expected a number of euros, got ${JSON.stringify(value)}`);
  }
  if (value < 0) throw new Error(`${where}: a negative amount (${value}) is not accepted`);
  const cents = value * 100;
  const rounded = Math.round(cents);
  // Float slack from the JSON parse (45.55 * 100 === 4555.000000000001) is
  // tolerated; a genuine third decimal is not.
  if (Math.abs(cents - rounded) > 1e-6) {
    throw new Error(`${where}: ${value} carries more than two decimals — a price has cents, not fractions of one`);
  }
  return rounded;
}

/** `€ 4 500,00` — the corpus's own format: NBSP thousands groups, comma decimals. */
export function formatMoney(cents: number, currency: 'EUR'): string {
  if (currency !== 'EUR') throw new Error(`unknown currency ${JSON.stringify(currency)} — only EUR is known`);
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, '0');
  const digits = String(whole);
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
  return `€${NB}${groups.join(NB)},${frac}`;
}