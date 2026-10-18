/**
 * ESC/POS for thermal receipt printers. Receipts are sent as a raster image so
 * Sinhala, Tamil and any other script print exactly as on screen (printer fonts
 * only cover Latin code pages).
 */

export type PaperWidth = 58 | 80;

/** Printable width in dots at 203 dpi, the common resolution of receipt printers. */
export const PAPER_DOTS: Record<PaperWidth, number> = { 58: 384, 80: 576 };

/** Decoded image: 8-bit samples, 1–4 channels (grey, grey+alpha, RGB, RGBA). */
export interface RasterImage {
  width: number;
  height: number;
  channels: number;
  data: ArrayLike<number>;
}

export interface Monochrome {
  /** Bytes per row (8 dots each, the last byte padded with white). */
  widthBytes: number;
  height: number;
  /** Row-major, most significant bit first; 1 = black. */
  bits: Uint8Array;
}

const ESC = 0x1b;
const GS = 0x1d;
// Many printers cap a single raster block's height; 255 rows is safe everywhere.
const MAX_BAND_ROWS = 255;

/** Black where luminance (transparent pixels count as white paper) is below `threshold`. */
export function toMonochrome(image: RasterImage, threshold = 160): Monochrome {
  const { width, height, channels, data } = image;
  if (channels < 1 || channels > 4) throw new Error(`Unsupported channel count ${channels}`);
  const widthBytes = Math.ceil(width / 8);
  const bits = new Uint8Array(widthBytes * height);
  const hasAlpha = channels === 2 || channels === 4;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      const luminance =
        channels >= 3 ? 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]! : data[i]!;
      const alpha = hasAlpha ? data[i + channels - 1]! / 255 : 1;
      const onPaper = luminance * alpha + 255 * (1 - alpha);
      if (onPaper < threshold) bits[y * widthBytes + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return { widthBytes, height, bits };
}

/**
 * A complete print job: reset, the image in raster bands (GS v 0), a few blank
 * lines so the receipt clears the tear bar, then a partial cut (ignored by
 * printers without a cutter).
 */
export function rasterJob(image: RasterImage, options: { cut?: boolean } = {}): Uint8Array {
  const mono = toMonochrome(image);
  const parts: number[][] = [[ESC, 0x40]];
  for (let top = 0; top < mono.height; top += MAX_BAND_ROWS) {
    const rows = Math.min(MAX_BAND_ROWS, mono.height - top);
    const header = [
      GS,
      0x76,
      0x30,
      0x00,
      mono.widthBytes & 0xff,
      mono.widthBytes >> 8,
      rows & 0xff,
      rows >> 8,
    ];
    const start = top * mono.widthBytes;
    parts.push(header, Array.from(mono.bits.subarray(start, start + rows * mono.widthBytes)));
  }
  parts.push([ESC, 0x64, 4]);
  if (options.cut ?? true) parts.push([GS, 0x56, 0x42, 0x00]);
  return Uint8Array.from(parts.flat());
}

/** Splits a job into pieces of at most `size` bytes for Bluetooth writes. */
export function chunk(bytes: Uint8Array, size: number): Uint8Array[] {
  const pieces: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size)
    pieces.push(bytes.subarray(offset, offset + size));
  return pieces;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 (the Bluetooth library's wire format). */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2]!;
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? '=' : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? '=' : ALPHABET[c & 63]!;
  }
  return out;
}

/** Decodes standard base64 (as returned by the screenshot library). */
export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bitsHeld = 0;
  let index = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | ALPHABET.indexOf(char);
    bitsHeld += 6;
    if (bitsHeld >= 8) {
      bitsHeld -= 8;
      out[index++] = (buffer >> bitsHeld) & 0xff;
    }
  }
  return out.subarray(0, index);
}
