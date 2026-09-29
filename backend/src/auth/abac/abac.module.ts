import { Module } from '@nestjs/common';
import { AbacGuard } from './abac.guard';
import { PatientAccessPolicy } from './policies/patient-access.policy';

@Module({
    providers: [AbacGuard, PatientAccessPolicy],
    exports: [AbacGuard, PatientAccessPolicy],
})
export class AbacModule {}
