import { createHash } from 'node:crypto';
import sharp from 'sharp';

// Decoded size limit: room for phone cameras while bounding memory per upload.
const MAX_INPUT_PIXELS = 50_000_000;
const MIN_SIDE = 64;
const FULL_SIDE = 1600;
const THUMB_SIDE = 400;

sharp.cache(false);

export type ImageIssue = 'unsupported_type' | 'unreadable' | 'too_small';

export class ImageRejected extends Error {
  constructor(readonly issue: ImageIssue) {
    super(`image rejected: ${issue}`);
  }
}

export interface ProcessedImage {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  /** SHA-256 (hex) of the uploaded bytes. */
  sha256: string;
}

type ImageType = 'jpeg' | 'png' | 'webp';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Identifies JPEG, PNG and WebP by their signatures; anything else (SVG, HEIC, ...) is refused. */
export function detectImageType(bytes: Buffer): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'webp';
  return null;
}

/**
 * Decodes an uploaded photo and re-encodes it as WebP in two sizes. Re-encoding
 * drops EXIF (including GPS position) and anything else carried in the file, and
 * applies the camera's rotation so the picture shows upright everywhere.
 */
export async function processProductImage(input: Buffer): Promise<ProcessedImage> {
  const type = detectImageType(input);
  if (!type) throw new ImageRejected('unsupported_type');
  const open = () =>
    sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated: false });

  let format: string | undefined;
  try {
    ({ format } = await open().metadata());
  } catch {
    throw new ImageRejected('unreadable');
  }
  if (format !== type) throw new ImageRejected('unsupported_type');

  try {
    const full = await open()
      .rotate()
      .resize({ width: FULL_SIDE, height: FULL_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    if (full.info.width < MIN_SIDE || full.info.height < MIN_SIDE)
      throw new ImageRejected('too_small');
    const thumb = await sharp(full.data)
      .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    return {
      full: full.data,
      thumb,
      width: full.info.width,
      height: full.info.height,
      sha256: createHash('sha256').update(input).digest('hex'),
    };
  } catch (error) {
    if (error instanceof ImageRejected) throw error;
    throw new ImageRejected('unreadable');
  }
}
