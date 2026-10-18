import sharp from 'sharp';
import { detectImageType, ImageRejected, processProductImage } from './image-processing';

const photo = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#c0392b' } });

async function rejection(input: Buffer): Promise<string> {
  try {
    await processProductImage(input);
  } catch (error) {
    if (error instanceof ImageRejected) return error.issue;
    throw error;
  }
  throw new Error('expected the image to be rejected');
}

describe('product image processing', () => {
  it('re-encodes to WebP in two sizes, upright, without camera metadata', async () => {
    // A 3000x2000 camera photo stored sideways (EXIF orientation 6) with a GPS position.
    const input = await photo(3000, 2000)
      .jpeg()
      .withExif({ IFD0: { Make: 'PhoneCam' }, IFD3: { GPSLatitudeRef: 'N' } })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const result = await processProductImage(input);
    const full = await sharp(result.full).metadata();
    const thumb = await sharp(result.thumb).metadata();
    expect(full.format).toBe('webp');
    // Rotated upright: portrait, longest side capped at 1600.
    expect([full.width, full.height]).toEqual([1067, 1600]);
    expect([result.width, result.height]).toEqual([1067, 1600]);
    expect(Math.max(thumb.width!, thumb.height!)).toBe(400);
    expect(full.exif).toBeUndefined();
    expect(full.orientation).toBeUndefined();
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps small photos at their size and accepts PNG and WebP', async () => {
    const png = await processProductImage(await photo(300, 200).png().toBuffer());
    expect([png.width, png.height]).toEqual([300, 200]);
    const webp = await processProductImage(await photo(500, 500).webp().toBuffer());
    expect([webp.width, webp.height]).toEqual([500, 500]);
  });

  it('refuses other file types, broken files and tiny images', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200"/></svg>',
    );
    expect(await rejection(svg)).toBe('unsupported_type');
    expect(await rejection(await photo(200, 200).gif().toBuffer())).toBe('unsupported_type');
    expect(await rejection(Buffer.from('not an image at all'))).toBe('unsupported_type');

    const jpeg = await photo(400, 400).jpeg().toBuffer();
    expect(await rejection(jpeg.subarray(0, 200))).toBe('unreadable');
    expect(await rejection(await photo(50, 300).png().toBuffer())).toBe('too_small');
  });

  it('identifies types by content, not by name', () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(detectImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))).toBe('webp');
    expect(detectImageType(Buffer.from('GIF89a'))).toBeNull();
  });
});
