import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { FdaController } from './fda.controller';
import { FdaService } from './fda.service';
import { RxNavService } from './rxnav.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
    }),
  ],
  controllers: [FdaController],
  providers: [FdaService, RxNavService],
})
export class FdaModule {}
