import { inflateSync } from 'node:zlib';

/**
 * A minimal, dependency-free PNG decoder — just enough to answer "which rows
 * of this raster carry ink," which is what `header-bound` needs to check for
 * overprinting and no test in this project could check before.
 *
 * `pdf-to-img`'s own decoder (`@napi-rs/canvas`, reached through pdfjs-dist)
 * would do this too, but it is an *optional* dependency of a devDependency —
 * not guaranteed present on every platform this project's CI runs on. A
 * project-owned decoder that only has to handle the one PNG shape
 * `rasterPages` actually produces (8-bit RGBA, no interlacing — true for
 * every PNG this project has rasterised so far) has no such platform gap,
 * at the cost of not being a general-purpose PNG reader. It isn't meant to
 * be one.
 */
function unfilter(raw: Buffer, width: number, height: number, bpp: number): Buffer {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let rawOffset = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset]!;
    rawOffset += 1;
    const rowStart = y * stride;
    const prevRowStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const raw8 = raw[rawOffset + x]!;
      const a = x >= bpp ? out[rowStart + x - bpp]! : 0;
      const b = y > 0 ? out[prevRowStart + x]! : 0;
      const c = x >= bpp && y > 0 ? out[prevRowStart + x - bpp]! : 0;
      let value: number;
      switch (filterType) {
        case 0:
          value = raw8;
          break;
        case 1:
          value = raw8 + a;
          break;
        case 2:
          value = raw8 + b;
          break;
        case 3:
          value = raw8 + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          value = raw8 + pr;
          break;
        }
        default:
          throw new Error(`unsupported PNG filter type ${filterType}`);
      }
      out[rowStart + x] = value & 0xff;
    }
    rawOffset += stride;
  }
  return out;
}

/**
 * Per-row "darkest pixel" luminance (0 black .. 255 white), decoded from a
 * PNG's own pixels rather than from pdf.js text coordinates — a coordinate
 * still has a value for text that got drawn behind something else, which is
 * exactly the failure mode this exists to catch (see the comment on
 * `HEADER_TITLE_LINE_HEIGHT_PT` in src/render/pdf.ts).
 */
export function inkRowsFromPng(png: Buffer): number[] {
  let offset = 8; // signature
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];
  while (offset < png.length) {
    const len = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9]!;
      const interlace = data[12];
      if (bitDepth !== 8) throw new Error(`inkRowsFromPng only handles 8-bit PNGs, got bit depth ${bitDepth}`);
      if (interlace !== 0) throw new Error('inkRowsFromPng only handles non-interlaced PNGs');
    } else if (type === 'IDAT') {
      idatChunks.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    offset += 8 + len + 4; // length + type + data + crc
  }
  if (width === 0 || height === 0) throw new Error('no IHDR chunk found');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : (() => { throw new Error(`inkRowsFromPng only handles RGB/RGBA, got color type ${colorType}`); })();

  const raw = unfilter(inflateSync(Buffer.concat(idatChunks)), width, height, channels);
  const stride = width * channels;
  const rows: number[] = [];
  for (let y = 0; y < height; y++) {
    let darkest = 255;
    const rowStart = y * stride;
    for (let x = 0; x < width; x++) {
      const px = rowStart + x * channels;
      const lum = (raw[px]! + raw[px + 1]! + raw[px + 2]!) / 3;
      if (lum < darkest) darkest = lum;
    }
    rows.push(darkest);
  }
  return rows;
}

/** First row (0-indexed, top of image) whose darkest pixel is below `threshold`. */
export function firstInkRow(png: Buffer, threshold = 200): number {
  const rows = inkRowsFromPng(png);
  const i = rows.findIndex((d) => d < threshold);
  if (i === -1) throw new Error('no ink found on this page at all');
  return i;
}

/** Last row (0-indexed, top of image) whose darkest pixel is below `threshold`, within [0, endExclusive). */
export function lastInkRowBefore(png: Buffer, endExclusive: number, threshold = 200): number {
  const rows = inkRowsFromPng(png);
  for (let y = Math.min(endExclusive, rows.length) - 1; y >= 0; y--) {
    if (rows[y]! < threshold) return y;
  }
  throw new Error(`no ink found before row ${endExclusive}`);
}
