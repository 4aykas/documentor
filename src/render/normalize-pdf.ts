// Two runs of page.pdf() differ in exactly two places: /CreationDate and
// /ModDate. Both are fixed-width, so substituting them in the raw bytes leaves
// every xref offset valid — measured 2026-08-12, and the reason byte-identical
// output costs one regex rather than a PDF rewrite. Chromium emits no /ID.

const DATE_RE = /(\/(?:Creation|Mod)Date \(D:)(\d{14})(\+00'00'\))/g;

function stampOf(epochSeconds: number): string {
  if (!Number.isFinite(epochSeconds) || epochSeconds < 0) {
    throw new Error(`epoch must be a non-negative number of seconds, got ${epochSeconds}`);
  }
  const d = new Date(epochSeconds * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const year = String(d.getUTCFullYear()).padStart(4, '0');
  if (year.length !== 4) throw new Error(`epoch ${epochSeconds} does not fit a four-digit year`);
  return `${year}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export function normalizePdfDates(buf: Buffer, epochSeconds: number): Buffer {
  const stamp = stampOf(epochSeconds);
  // latin1 is a byte-preserving round trip for every code unit 0..255, which is
  // what makes a string replace safe on binary content here.
  const s = buf.toString('latin1').replace(DATE_RE, `$1${stamp}$3`);
  return Buffer.from(s, 'latin1');
}
