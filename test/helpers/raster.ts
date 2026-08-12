import { pdf } from 'pdf-to-img';

/** One PNG per page. Scale 2 is enough to see a collision and small enough to commit. */
export async function rasterPages(buf: Buffer, scale = 2): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for await (const page of await pdf(buf, { scale })) out.push(Buffer.from(page));
  return out;
}
