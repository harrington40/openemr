import { Module } from '@nestjs/common';
import { LabsController, LabDashboardController } from './labs.controller';
import { LabsService } from './labs.service';
import { BillingModule } from '../billing/billing.module';

@Module({
    imports: [BillingModule],
    controllers: [LabsController, LabDashboardController],
    providers: [LabsService],
})
export class LabsModule {}
