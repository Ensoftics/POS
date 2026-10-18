import { convertIndexedToRgb, decode } from 'fast-png';
import { fromBase64, type RasterImage } from './escpos';

/** Turns a base64 PNG (a captured receipt) into 8-bit samples for the printer. */
export function decodeReceiptPng(base64: string): RasterImage {
  const png = decode(fromBase64(base64));
  if (png.palette) {
    const rgb = convertIndexedToRgb(png);
    return {
      width: png.width,
      height: png.height,
      channels: png.palette[0]?.length ?? 3,
      data: rgb,
    };
  }
  if (png.depth === 8) return png;
  // 16-bit samples keep their high byte; 1/2/4-bit greys are scaled up to 0-255.
  const scale = png.depth === 16 ? 1 / 257 : 255 / (2 ** png.depth - 1);
  return {
    width: png.width,
    height: png.height,
    channels: png.channels,
    data: Array.from(png.data, (sample) => Math.round(sample * scale)),
  };
}
