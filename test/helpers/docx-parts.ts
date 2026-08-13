// A .docx is a zip. Every read-back assertion in this suite goes through here,
// so a test never has to know that.

import JSZip from 'jszip';

export async function docxPart(buf: Buffer, name: string): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file(name);
  if (!file) throw new Error(`no such part: ${name} (the package has ${Object.keys(zip.files).join(', ')})`);
  return await file.async('string');
}

export async function docxEntries(buf: Buffer): Promise<string[]> {
  return Object.keys((await JSZip.loadAsync(buf)).files);
}

// The stored DOS timestamp is one of the three things that vary between two
// packs of the same input, so a caller checking reproducibility needs it, not
// just the entry names — paired with the name so a failure can name the entry
// it's about, not just its position in an iteration order.
export async function docxEntryDates(buf: Buffer): Promise<{ name: string; date: Date }[]> {
  const zip = await JSZip.loadAsync(buf);
  return Object.entries(zip.files).map(([name, f]) => ({ name, date: f.date }));
}
