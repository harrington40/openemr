import { Module } from '@nestjs/common';
import { ProviderController } from './provider.controller';
import { ProviderService } from './provider.service';
import { EmergencyModule } from '../emergency/emergency.module';

@Module({
  // The dashboard lists the clinician's live emergency patients, and that list has
  // to be built from the same decorator the triage board uses.
  imports: [EmergencyModule],
  controllers: [ProviderController],
  providers: [ProviderService],
  exports: [ProviderService],
})
export class ProviderModule {}
