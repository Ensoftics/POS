import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { Entitlements } from './entitlements';
import { SubscriptionLifecycle } from './lifecycle.service';
import { PaymentProvider } from './payment-provider';
import { PayHereProvider } from './payhere.provider';
import { SubscriptionGuard } from './subscription.guard';

/** Global so any feature can check plan limits through Entitlements. */
@Global()
@Module({
  controllers: [BillingController],
  providers: [
    BillingService,
    Entitlements,
    SubscriptionLifecycle,
    SubscriptionGuard,
    { provide: PaymentProvider, useClass: PayHereProvider },
  ],
  exports: [
    BillingService,
    Entitlements,
    SubscriptionGuard,
    SubscriptionLifecycle,
    PaymentProvider,
  ],
})
export class BillingModule {}
