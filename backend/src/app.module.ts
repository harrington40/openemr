import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppConfigController } from './config/app-config.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import { StorageModule } from './storage/storage.module';
import { PatientsModule } from './patients/patients.module';
import { AuthModule } from './auth/auth.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { EncountersModule } from './encounters/encounters.module';
import { ReferenceModule } from './reference/reference.module';
import { ClinicalModule } from './clinical/clinical.module';
import { LabsModule } from './labs/labs.module';
import { BillingModule } from './billing/billing.module';
import { AdminModule } from './admin/admin.module';
import { ReportsModule } from './reports/reports.module';
import { CcdaModule } from './ccda/ccda.module';
import { SmartModule } from './smart/smart.module';
import { FhirModule } from './fhir/fhir.module';
import { EventBusModule } from './event-bus/event-bus.module';
import { MessagingModule } from './messaging/messaging.module';
import { ProviderModule } from './provider/provider.module';
import { FdaModule } from './fda/fda.module';
import { DocumentsModule } from './documents/documents.module';
import { AvatarsModule } from './avatars/avatars.module';
import { ImagingModule } from './imaging/imaging.module';
import { LicenseModule } from './license/license.module';
import { NursingModule } from './nursing/nursing.module';
import { PatientChatModule } from './patient-chat/patient-chat.module';
import { ReferralsModule } from './referrals/referrals.module';
import { InventoryModule } from './inventory/inventory.module';
import { MidwifeModule } from './midwife/midwife.module';
import { BookingsModule } from './bookings/bookings.module';
import { LabReportsModule } from './labreports/labreports.module';
import { InpatientModule } from './inpatient/inpatient.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MailboxModule } from './mailbox/mailbox.module';
import { EmergencyModule } from './emergency/emergency.module';

@Module({
  controllers: [AppConfigController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        host: config.get<string>('database.host'),
        port: config.get<number>('database.port'),
        username: config.get<string>('database.username'),
        password: config.get<string>('database.password'),
        database: config.get<string>('database.database'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: false,
        // Explicit opt-in. Keyed off NODE_ENV, this silently switched ON whenever
        // the variable went missing — which a deploy did by restarting pm2 with
        // --update-env from a shell that had no NODE_ENV. TypeORM then logged
        // every statement with its parameters, writing patient names, dates of
        // birth and phone numbers into plaintext log files (78 MB of them).
        logging: process.env.DB_LOGGING === 'true',
        extra: { charset: 'utf8mb4_unicode_ci' },
      }),
    }),
    StorageModule,
    EventBusModule.forRoot({
      adapter: (process.env.EVENT_BUS_ADAPTER as 'in-memory' | 'kafka') || 'in-memory',
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
      clientId: process.env.KAFKA_CLIENT_ID || 'openrx',
    }),
    AuthModule,
    PatientsModule,
    AppointmentsModule,
    EncountersModule,
    ReferenceModule,
    ClinicalModule,
    LabsModule,
    BillingModule,
    AdminModule,
    ReportsModule,
    CcdaModule,
    SmartModule,
    FhirModule,
    MessagingModule,
    ProviderModule,
    FdaModule,
    DocumentsModule,
    AvatarsModule,
    ImagingModule,
    BookingsModule,
    LabReportsModule,
    InpatientModule,
    NotificationsModule,
    MailboxModule,
    EmergencyModule,


    LicenseModule,
    NursingModule,
    PatientChatModule,
    ReferralsModule,
    InventoryModule,
    MidwifeModule,
  ],
})
export class AppModule {}
