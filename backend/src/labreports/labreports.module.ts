import { Module } from '@nestjs/common';
import { LabReportsController } from './labreports.controller';
import { LabReportsService } from './labreports.service';

@Module({
  controllers: [LabReportsController],
  providers: [LabReportsService],
  exports: [LabReportsService],
})
export class LabReportsModule {}
