// Two runs of page.pdf() differ in exactly two places: /CreationDate and
// /ModDate. Both are fixed-width, so substituting them in the raw bytes leaves
// every xref offset valid — measured 2026-08-12, and the reason byte-identical
// output costs one regex rather than a PDF rewrite. Chromium emits no /ID.

const DATE_RE = /(\/(?:Creation|Mod)Date \(D:)(\d{14})(\+00'00'\))/g;

function stampOf(epochSeconds: number): string {
  if (!Number.isInteger(epochSeconds) || epochSeconds < 0) {
    throw new Error(`epoch must be a non-negative whole number of seconds, got ${epochSeconds}`);
  }
  const d = new Date(epochSeconds * 1000);
  // An epoch past the Date range (roughly 8.64e12 seconds) produces an
  // Invalid Date whose getUTCFullYear() is NaN. String(NaN).padStart(4, '0')
  // is "0NaN" — four characters — so the old length-only check below let it
  // through, and every String(NaN) field after it silently widened the
  // fourteen-digit stamp. Catching Invalid Date directly, before formatting
  // any field, is what the fixed-width substitution's correctness depends on.
  if (Number.isNaN(d.getTime())) {
    throw new Error(`epoch ${epochSeconds} does not fall within the representable Date range`);
  }
  const p = (n: number) => String(n).padStart(2, '0');
  const year = String(d.getUTCFullYear()).padStart(4, '0');
  if (year.length !== 4) throw new Error(`epoch ${epochSeconds} does not fit a four-digit year`);
  const stamp = `${year}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  // Belt and braces: the width this function produces is the whole reason it
  // exists (see the module comment), so assert it on the output rather than
  // trust that every field-level guard above stays sufficient forever.
  if (!/^\d{14}$/.test(stamp)) {
    throw new Error(`epoch ${epochSeconds} produced a malformed fourteen-digit stamp: ${JSON.stringify(stamp)}`);
  }
  return stamp;
}

export function normalizePdfDates(buf: Buffer, epochSeconds: number): Buffer {
  const stamp = stampOf(epochSeconds);
  // latin1 is a byte-preserving round trip for every code unit 0..255, which is
  // what makes a string replace safe on binary content here.
  const s = buf.toString('latin1').replace(DATE_RE, `$1${stamp}$3`);
  return Buffer.from(s, 'latin1');
}
