import type { AppConfig } from '../config/app-config';
import { imageObjectKey, MediaLinks } from './media-links';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const IMAGE = '33333333-3333-4333-8333-333333333333';

const links = (secret = 'x'.repeat(40)) =>
  new MediaLinks({
    JWT_ACCESS_SECRET: secret,
    API_PUBLIC_URL: 'https://api.example.lk/',
  } as AppConfig);

const signatureOf = (url: string) => new URL(url).searchParams.get('s')!;

describe('signed image links', () => {
  it('are stable and point at the media route', () => {
    const url = links().imageUrl(TENANT, IMAGE, 'thumb');
    expect(url).toBe(links().imageUrl(TENANT, IMAGE, 'thumb'));
    expect(url).toMatch(
      new RegExp(
        `^https://api\\.example\\.lk/api/v1/media/t/${TENANT}/i/${IMAGE}/thumb\\.webp\\?s=[\\w-]{32}$`,
      ),
    );
  });

  it('verify only for the same tenant, image, size and secret', () => {
    const subject = links();
    const signature = signatureOf(subject.imageUrl(TENANT, IMAGE, 'thumb'));
    expect(subject.verify(TENANT, IMAGE, 'thumb', signature)).toBe(true);
    expect(subject.verify(OTHER_TENANT, IMAGE, 'thumb', signature)).toBe(false);
    expect(subject.verify(TENANT, IMAGE, 'full', signature)).toBe(false);
    expect(subject.verify(TENANT, IMAGE, 'thumb', signature.slice(0, 31))).toBe(false);
    expect(links('y'.repeat(40)).verify(TENANT, IMAGE, 'thumb', signature)).toBe(false);
  });

  it('map to tenant-scoped object keys', () => {
    expect(imageObjectKey(TENANT, IMAGE, 'full')).toBe(
      `tenants/${TENANT}/images/${IMAGE}/full.webp`,
    );
  });
});
