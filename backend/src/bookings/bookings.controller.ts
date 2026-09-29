import {
    Controller,
    Post,
    Get,
    Patch,
    Param,
    Body,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BookingsService } from './bookings.service';
import type { CreateBookingDto } from './bookings.service';

/** Body accepted when approving a booking request. */
interface ApproveBookingDto {
    providerId?: number | string;
}

/** Body accepted when declining a booking request. */
interface DeclineBookingDto {
    note?: string;
}

/**
 * Public booking endpoint — the link shared on WhatsApp / social media.
 * No staff JWT required so any member of the public can request an appointment.
 */
@Controller('booking')
export class BookingPublicController {
    constructor(private readonly bookings: BookingsService) {}

    @Post('request')
    request(@Body() dto: CreateBookingDto) {
        return this.bookings.createRequest(dto);
    }
}

/**
 * Registrar / administrator booking review endpoints.
 */
@Controller('bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BookingsController {
    constructor(private readonly bookings: BookingsService) {}

    @Get('requests')
    @Roles('admin', 'front_desk')
    list() {
        return this.bookings.listRequests();
    }

    @Patch('requests/:id/approve')
    @Roles('admin', 'front_desk')
    approve(@Param('id') id: string, @Body() dto?: ApproveBookingDto) {
        return this.bookings.approve(parseInt(id, 10), dto?.providerId);
    }

    @Patch('requests/:id/decline')
    @Roles('admin', 'front_desk')
    decline(@Param('id') id: string, @Body() dto?: DeclineBookingDto) {
        return this.bookings.decline(parseInt(id, 10), dto?.note);
    }
}
