import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { AppException } from '../common/app-exception';
import { IMAGE_SIZES, type ImageSize, imageObjectKey, MediaLinks } from './media-links';
import { ObjectStorage } from './object-storage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE = /^(full|thumb)\.webp$/;

/**
 * Opens a signed image link: checks the signature, then redirects to a
 * short-lived URL of the private bucket. No sign-in header is needed, so links
 * work in <img> tags; without a valid signature the answer is a plain 404.
 * Signing is local (no database or storage call), so throttling is not needed.
 */
@Controller('media')
export class MediaController {
  constructor(
    private readonly links: MediaLinks,
    private readonly storage: ObjectStorage,
  ) {}

  @Get('t/:tenantId/i/:imageId/:file')
  @Public()
  @SkipThrottle()
  @ApiExcludeEndpoint()
  async image(
    @Param('tenantId') tenantId: string,
    @Param('imageId') imageId: string,
    @Param('file') file: string,
    @Query('s') signature: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const size = FILE.exec(file)?.[1] as ImageSize | undefined;
    if (
      !UUID.test(tenantId) ||
      !UUID.test(imageId) ||
      !size ||
      !IMAGE_SIZES.includes(size) ||
      typeof signature !== 'string' ||
      !this.links.verify(tenantId, imageId, size, signature)
    )
      throw AppException.notFound();
    const url = await this.storage.signedGetUrl(imageObjectKey(tenantId, imageId, size));
    // Shorter than the signed URL's remaining life, so a cached redirect never points at an expired URL.
    res.setHeader('Cache-Control', 'private, max-age=1800');
    // The web app and the API may sit on different origins in development.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.redirect(302, url);
  }
}
