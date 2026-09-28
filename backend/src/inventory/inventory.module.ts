import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { VendorPortalController } from './vendor-portal.controller';
import { InventoryService } from './inventory.service';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BillingModule],
  controllers: [InventoryController, VendorPortalController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
