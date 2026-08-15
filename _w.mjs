const JSZip = (await import('jszip')).default;
const fs = await import('node:fs/promises');
const z = await JSZip.loadAsync(await fs.readFile('C:/Users/maxudl/Desktop/tebin-offers/cover-final/example.proposal-cover.tebin.docx'));
const xml = await z.file('word/document.xml').async('string');
const a = xml.match(/<wp:anchor[\s\S]*?<\/wp:anchor>/)?.[0] ?? 'NO ANCHOR';
console.log(a.replace(/></g, '>\n<').split('\n').filter(l => /positionH|positionV|align|posOffset|extent|wp:anchor /.test(l)).join('\n'));
for (const n of Object.keys(z.files).filter(n => n.startsWith('word/media/'))) {
  const b = await z.file(n).async('nodebuffer');
  console.log(n, b.readUInt32BE(16)+'x'+b.readUInt32BE(20), b.length+'B');
}
