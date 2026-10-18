import { Module } from '@nestjs/common';
import { LocationsModule } from '../locations/locations.module';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

@Module({
  imports: [LocationsModule],
  controllers: [TenantController],
  providers: [TenantService],
})
export class TenantModule {}
