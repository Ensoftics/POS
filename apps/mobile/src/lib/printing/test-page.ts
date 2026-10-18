import { PAPER_DOTS, type PaperWidth, rasterJob } from './escpos';

/**
 * A test pattern as wide as the paper: a frame with diagonal stripes. If the
 * frame's right edge is cut off, the paper width setting is too wide.
 */
export function testPageJob(paperWidth: PaperWidth): Uint8Array {
  const width = PAPER_DOTS[paperWidth];
  const height = 160;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const frame = x < 4 || x >= width - 4 || y < 4 || y >= height - 4;
      const stripe = (x + y) % 32 < 6;
      data[y * width + x] = frame || stripe ? 0 : 255;
    }
  return rasterJob({ width, height, channels: 1, data });
}
