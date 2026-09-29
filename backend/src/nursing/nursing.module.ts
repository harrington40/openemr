import { Module } from '@nestjs/common';
import { NursingController } from './nursing.controller';
import { NursingService } from './nursing.service';
import { SmartRoutingService } from './smart-routing.service';

@Module({
    controllers: [NursingController],
    providers: [NursingService, SmartRoutingService],
    exports: [SmartRoutingService],
})
export class NursingModule {}
