import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingIntegrityService } from './billing-integrity.service';

@Module({
    controllers: [BillingController],
    providers: [BillingService, BillingIntegrityService],
    exports: [BillingService, BillingIntegrityService],
})
export class BillingModule {}
