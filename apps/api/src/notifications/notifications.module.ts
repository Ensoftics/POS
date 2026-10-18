import { Global, Module } from '@nestjs/common';
import { DailySweep } from './daily-sweep.service';
import { FeatureFlags } from './feature-flags.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/** Global so any feature can raise notifications or check a flag. */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [FeatureFlags, NotificationsService, DailySweep],
  exports: [FeatureFlags, NotificationsService, DailySweep],
})
export class NotificationsModule {}
