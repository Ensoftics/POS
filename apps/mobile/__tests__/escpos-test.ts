import { encode } from 'fast-png';
import {
  chunk,
  fromBase64,
  PAPER_DOTS,
  rasterJob,
  toBase64,
  toMonochrome,
} from '@/lib/printing/escpos';
import { decodeReceiptPng } from '@/lib/printing/receipt-image';

/** A width x height RGBA image: white, with black where `ink(x, y)`. */
function image(width: number, height: number, ink: (x: number, y: number) => boolean) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const value = ink(x, y) ? 0 : 255;
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  return { width, height, channels: 4, data };
}

describe('ESC/POS raster printing', () => {
  it('packs pixels into bits, most significant first, padding rows with white', () => {
    const mono = toMonochrome(image(10, 2, (x, y) => y === 0 && (x === 0 || x === 9)));
    expect(mono.widthBytes).toBe(2);
    expect(Array.from(mono.bits)).toEqual([0b1000_0000, 0b0100_0000, 0, 0]);
  });

  it('treats transparent pixels as paper and grey by the threshold', () => {
    const data = Uint8Array.from([
      0, 0, 0, 0, 0, 0, 0, 255, 200, 200, 200, 255, 100, 100, 100, 255,
    ]);
    const mono = toMonochrome({ width: 4, height: 1, channels: 4, data });
    expect(mono.bits[0]).toBe(0b0101_0000);
  });

  it('builds a job: reset, raster bands of at most 255 rows, feed and cut', () => {
    const job = rasterJob(image(16, 300, (x) => x < 8));
    expect(Array.from(job.subarray(0, 2))).toEqual([0x1b, 0x40]);
    // First band: GS v 0, 2 bytes wide, 255 rows.
    expect(Array.from(job.subarray(2, 10))).toEqual([0x1d, 0x76, 0x30, 0, 2, 0, 255, 0]);
    expect(Array.from(job.subarray(10, 12))).toEqual([0xff, 0x00]);
    const second = 10 + 2 * 255;
    expect(Array.from(job.subarray(second, second + 8))).toEqual([
      0x1d, 0x76, 0x30, 0, 2, 0, 45, 0,
    ]);
    expect(Array.from(job.subarray(-7))).toEqual([0x1b, 0x64, 4, 0x1d, 0x56, 0x42, 0]);
    expect(job.length).toBe(2 + 8 + 510 + 8 + 90 + 7);
    expect(
      Array.from(
        rasterJob(
          image(8, 1, () => false),
          { cut: false },
        ).subarray(-3),
      ),
    ).toEqual([0x1b, 0x64, 4]);
  });

  it('splits jobs for Bluetooth and encodes base64 both ways', () => {
    const bytes = Uint8Array.from({ length: 10 }, (_, i) => i * 25);
    expect(chunk(bytes, 4).map((piece) => piece.length)).toEqual([4, 4, 2]);
    const expected = ['', 'AA==', 'ABk=', 'ABky', 'ABkyS2R9lq/I4Q=='];
    [0, 1, 2, 3, 10].forEach((length, index) => {
      const slice = bytes.subarray(0, length);
      const text = toBase64(slice);
      expect(text).toBe(expected[index]);
      expect(Array.from(fromBase64(text))).toEqual(Array.from(slice));
    });
  });

  it('decodes a captured PNG into an image as wide as the paper', () => {
    const png = encode(image(PAPER_DOTS[58], 3, (x) => x === 0));
    const decoded = decodeReceiptPng(toBase64(png));
    expect(decoded).toMatchObject({ width: 384, height: 3 });
    expect(toMonochrome(decoded).bits[0]).toBe(0x80);
  });
});
