// Never assert on a PDF by searching its bytes for a phrase — the operands are
// glyph indices, so the search silently finds nothing and the obvious
// conclusion ("the text is missing") is wrong.

export async function pdfText(buf: Buffer): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    // Chromium's @font-face unicode-range subsetting (see fonts.ts) switches
    // the embedded face mid-word for mixed scripts — e.g. plain "Za" sits in
    // the Latin-1 face while the Polish "ż" that follows it sits in the
    // Latin-Extended-A face — and each font switch ends one text-showing
    // operator and starts another, so pdfjs reports it as a new item with no
    // separator between them. A blanket space between every item would glue
    // a real space onto the *middle* of "Zażółć". Real word gaps already
    // arrive as their own items (str === ' '), and pdfjs marks true line
    // breaks with hasEOL, so only those two places should ever gain a space.
    pages.push(
      content.items
        .map((it) => ('str' in it ? it.str + (it.hasEOL ? ' ' : '') : ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  }
  return pages;
}
