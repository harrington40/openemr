import { Module } from '@nestjs/common';
import { MidwifeController } from './midwife.controller';
import { MidwifeService } from './midwife.service';

@Module({
    controllers: [MidwifeController],
    providers: [MidwifeService],
    exports: [MidwifeService],
})
export class MidwifeModule {}
