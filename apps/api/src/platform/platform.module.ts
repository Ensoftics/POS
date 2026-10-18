import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAuthController, PlatformController } from './platform.controller';
import { PlatformGuard } from './platform.guard';
import { PlatformService } from './platform.service';

@Module({
  imports: [AuthModule],
  controllers: [PlatformAuthController, PlatformController],
  providers: [PlatformAuditService, PlatformAuthService, PlatformGuard, PlatformService],
})
export class PlatformModule {}
