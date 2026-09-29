import { Module } from '@nestjs/common';
import { PatientsModule } from '../patients/patients.module';
import { BookingsService } from './bookings.service';
import {
    BookingPublicController,
    BookingsController,
} from './bookings.controller';

@Module({
    imports: [PatientsModule],
    controllers: [BookingPublicController, BookingsController],
    providers: [BookingsService],
    exports: [BookingsService],
})
export class BookingsModule {}
