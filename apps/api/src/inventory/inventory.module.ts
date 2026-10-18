import { Module } from '@nestjs/common';
import { AdjustmentsService } from './adjustments.service';
import { CountsService } from './counts.service';
import { InventoryController } from './inventory.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchasingController } from './purchasing.controller';
import { ReceiptsService } from './receipts.service';
import { StockLedger } from './stock-ledger';
import { StockService } from './stock.service';
import { SuppliersService } from './suppliers.service';
import { TransfersService } from './transfers.service';

@Module({
  controllers: [PurchasingController, InventoryController],
  providers: [
    StockLedger,
    StockService,
    SuppliersService,
    PurchaseOrdersService,
    ReceiptsService,
    AdjustmentsService,
    TransfersService,
    CountsService,
  ],
  exports: [StockLedger, StockService],
})
export class InventoryModule {}
