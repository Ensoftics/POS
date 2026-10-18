import { Module } from '@nestjs/common';
import { CustomerLedger } from './customer-ledger';
import { LoyaltyLedger } from './loyalty-ledger';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CustomerLedger, LoyaltyLedger],
  exports: [CustomerLedger, LoyaltyLedger],
})
export class CustomersModule {}
