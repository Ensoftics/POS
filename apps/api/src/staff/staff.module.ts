import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DevicesService } from './devices.service';
import { DevicesController, StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [AuthModule],
  controllers: [StaffController, DevicesController],
  providers: [StaffService, DevicesService],
})
export class StaffModule {}
