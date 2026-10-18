import { Global, Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaLinks } from './media-links';
import { ObjectStorage } from './object-storage';

/** Object storage and signed image links, shared by the catalogue and sync. */
@Global()
@Module({
  controllers: [MediaController],
  providers: [ObjectStorage, MediaLinks],
  exports: [ObjectStorage, MediaLinks],
})
export class MediaModule {}
