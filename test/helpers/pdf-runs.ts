// Text from a PDF, tagged with the size it was set at.
//
// pdf-text.ts answers "what does the page say"; this answers "what does the
// page say, and set as what" — the only way to ask a PDF whether it typeset
// something as a heading. Chromium leaves no structure behind (these PDFs are
// untagged), so type size is the evidence available, and it is also what a
// human uses when they glance at a page and see a heading.

export type PdfRun = { text: string; sizePt: number };

/**
 * One run per stretch of same-sized text, in reading order, page by page.
 *
 * The concatenation rule is the one pdf-text.ts explains at length: Chromium's
 * unicode-range subsetting splits a word across faces mid-glyph, so items are
 * joined with nothing between them, and only a real space item or an explicit
 * hasEOL contributes whitespace. Runs never span a page break, so a paragraph
 * continued overleaf reads as two runs — which is what it is on paper.
 */
export async function pdfRuns(buf: Buffer): Promise<PdfRun[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
  const out: PdfRun[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    const page: PdfRun[] = [];
    for (const it of content.items) {
      if (!('str' in it)) continue;
      const item = it as { str: string; hasEOL?: boolean; transform: number[] };
      const text = item.str + (item.hasEOL ? ' ' : '');
      const last = page[page.length - 1];
      // A whitespace-only item is a word gap: it belongs to whatever run it
      // sits inside, carries no size of its own, and never starts a run.
      if (item.str.trim() === '') {
        if (last) last.text += text;
        continue;
      }
      const sizePt = Math.round((item.transform[0] ?? 0) * 10) / 10;
      if (last && Math.abs(last.sizePt - sizePt) <= 0.05) last.text += text;
      else page.push({ sizePt, text });
    }
    for (const run of page) {
      const text = run.text.replace(/\s+/g, ' ').trim();
      if (text !== '') out.push({ sizePt: run.sizePt, text });
    }
  }
  return out;
}
