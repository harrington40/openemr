import { Module } from '@nestjs/common';
import { InpatientController } from './inpatient.controller';
import { InpatientService } from './inpatient.service';

@Module({
  controllers: [InpatientController],
  providers: [InpatientService],
  exports: [InpatientService],
})
export class InpatientModule {}
