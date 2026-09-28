import { Module } from '@nestjs/common';
import { EmergencyController } from './emergency.controller';
import { EmergencyService } from './emergency.service';
import { EmergencySchedulerService } from './emergency-scheduler.service';
import { NursingModule } from '../nursing/nursing.module';
import { BillingModule } from '../billing/billing.module';
import { MessagingModule } from '../messaging/messaging.module';

@Module({
  // Triage hands its acuity to the existing nursing router (so the patient lands
  // on the RN workspace with a named nurse), bills through the existing
  // triage-intake charge (already idempotent per patient), and pages through the
  // existing messaging pipeline (realtime + email/SMS + dedup + mailbox).
  imports: [NursingModule, BillingModule, MessagingModule],
  controllers: [EmergencyController],
  providers: [EmergencyService, EmergencySchedulerService],
  exports: [EmergencyService],
})
export class EmergencyModule {}
