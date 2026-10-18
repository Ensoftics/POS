import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { API_PREFIX } from '../bootstrap';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

export const IMAGE_SIZES = ['full', 'thumb'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

/** Where an image file lives in the bucket; derived, never taken from a request. */
export function imageObjectKey(tenantId: string, imageId: string, size: ImageSize): string {
  return `tenants/${tenantId}/images/${imageId}/${size}.webp`;
}

/**
 * Stable, signed links to product images. A link names the tenant and image and
 * carries an HMAC over both, so it works where no sign-in header is sent (<img>,
 * the Android image cache) without letting anyone reach another file. Links stay
 * valid until the image is deleted or JWT_ACCESS_SECRET is rotated.
 */
@Injectable()
export class MediaLinks {
  private readonly key: Buffer;
  private readonly base: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = Buffer.from(
      hkdfSync('sha256', config.JWT_ACCESS_SECRET, 'pos-media-links', 'image-link-v1', 32),
    );
    this.base = `${config.API_PUBLIC_URL.replace(/\/+$/, '')}/${API_PREFIX}/media`;
  }

  imageUrl(tenantId: string, imageId: string, size: ImageSize): string {
    const signature = this.sign(tenantId, imageId, size);
    return `${this.base}/t/${tenantId}/i/${imageId}/${size}.webp?s=${signature}`;
  }

  verify(tenantId: string, imageId: string, size: ImageSize, signature: string): boolean {
    const expected = Buffer.from(this.sign(tenantId, imageId, size));
    const given = Buffer.from(signature);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private sign(tenantId: string, imageId: string, size: ImageSize): string {
    return createHmac('sha256', this.key)
      .update(`${tenantId}/${imageId}/${size}`)
      .digest('base64url')
      .slice(0, 32);
  }
}
