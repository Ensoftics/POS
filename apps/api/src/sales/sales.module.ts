import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomersModule } from '../customers/customers.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ApprovalsService } from './approvals.service';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { ShiftsService } from './shifts.service';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { TaxRatesService } from './tax-rates.service';

@Module({
  imports: [InventoryModule, AuthModule, CustomersModule],
  controllers: [SalesController, ReturnsController, SyncController],
  providers: [
    TaxRatesService,
    ShiftsService,
    SalesService,
    ApprovalsService,
    ReturnsService,
    SyncService,
  ],
})
export class SalesModule {}
