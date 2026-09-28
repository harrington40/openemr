import { Module } from '@nestjs/common';
import { PatientChatController } from './patient-chat.controller';
import { PatientChatService } from './patient-chat.service';

@Module({
  controllers: [PatientChatController],
  providers: [PatientChatService],
  exports: [PatientChatService],
})
export class PatientChatModule {}
