import { Module } from '@nestjs/common';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { MessagingSweep } from './messaging-sweep.service';
import { NotifyLkSms, SmsSender } from './sms-sender';

@Module({
  controllers: [MessagingController],
  providers: [MessagingService, MessagingSweep, { provide: SmsSender, useClass: NotifyLkSms }],
  exports: [MessagingSweep, SmsSender],
})
export class MessagingModule {}
