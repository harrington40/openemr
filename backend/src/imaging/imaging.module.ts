import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImagingController } from './imaging.controller';
import { ImagingService } from './imaging.service';
import { Imaging } from './imaging.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Imaging])],
  controllers: [ImagingController],
  providers: [ImagingService],
  exports: [ImagingService],
})
export class ImagingModule {}
