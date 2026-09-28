import { Module } from '@nestjs/common';
import { CcdaController } from './ccda.controller';

@Module({ controllers: [CcdaController] })
export class CcdaModule {}
