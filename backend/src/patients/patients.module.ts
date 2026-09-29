import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PatientsController } from './patients.controller';
import { PortalController } from './portal.controller';
import { PatientsService } from './patients.service';
import { Patient } from './patient.entity';
import { PatientPortalModule } from '../patient-portal/patient-portal.module';
import { EmergencyModule } from '../emergency/emergency.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Patient]),
        PatientPortalModule,
        // The chart payload carries the patient's emergency state (banner + triage
        // history). EmergencyModule does not import PatientsModule, so no cycle.
        EmergencyModule,
        JwtModule.register({
            secret: process.env.JWT_SECRET || 'openrx-secret-key-2024',
            signOptions: { expiresIn: '8h' },
        }),
    ],
    controllers: [PatientsController, PortalController],
    providers: [PatientsService],
    exports: [PatientsService],
})
export class PatientsModule {}
