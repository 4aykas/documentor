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
