import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';
import { LicenseGuard } from './license.guard';
import { License } from './license.entity';

@Module({
    imports: [TypeOrmModule.forFeature([License])],
    controllers: [LicenseController],
    providers: [LicenseService, LicenseGuard],
    exports: [LicenseService, LicenseGuard],
})
export class LicenseModule {}
