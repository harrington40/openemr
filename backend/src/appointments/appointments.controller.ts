import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Param,
    Query,
    Body,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { parseNumericId } from '../common/id.util';
import { AppointmentsService } from './appointments.service';
import type { CreateAppointmentDto } from './appointments.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'physician', 'front_desk', 'midwife', 'nurse')
export class AppointmentsController {
    constructor(private readonly appointmentsService: AppointmentsService) {}

    @Get('appointments')
    async findAll(
        @Query('date') date?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('category') category?: string,
    ) {
        return this.appointmentsService.findAll({
            date,
            startDate,
            endDate,
            category,
        });
    }

    /**
     * Get walk-in patients (no appointment, but checked in via patient_tracker).
     *
     * This must stay declared before `GET appointments/:eid`. Express registers
     * routes in declaration order, so with the parameterised route first this path
     * matched `findOne` with `eid = 'walk-ins'`, `parseInt` made that NaN, and the
     * board's walk-in column silently stayed empty behind a MySQL error.
     */
    @Get('appointments/walk-ins')
    async getWalkIns(@Query('date') date?: string) {
        return this.appointmentsService.getWalkInPatients(date);
    }

    @Get('appointments/open-slots')
    async findOpenSlots(
        @Query('date') date: string,
        @Query('provider') provider?: string,
    ) {
        if (!date) return [];
        return this.appointmentsService.findOpenSlots(date, provider);
    }

    @Get('appointments/provider-schedule')
    @Roles('admin', 'front_desk', 'physician')
    async getProviderSchedule(@Query('date') date: string) {
        const d = date || new Date().toISOString().substring(0, 10);
        return this.appointmentsService.getProviderSchedule(d);
    }

    @Post('appointments/provider-schedule')
    @Roles('admin', 'front_desk')
    async addProviderSchedule(
        @Body()
        body: {
            date: string;
            providerId: number;
            startTime?: string;
            endTime?: string;
        },
    ) {
        return this.appointmentsService.addProviderSchedule(
            body.date,
            body.providerId,
            body.startTime || '08:00',
            body.endTime || '17:00',
        );
    }

    @Delete('appointments/provider-schedule/:eid')
    @Roles('admin')
    async deleteProviderSchedule(@Param('eid') eid: string) {
        return this.appointmentsService.deleteProviderSchedule(
            parseNumericId(eid, 'Appointment id'),
        );
    }

    @Get('appointments/:eid')
    async findOne(@Param('eid') eid: string) {
        return this.appointmentsService.findOne(
            parseNumericId(eid, 'Appointment id'),
        );
    }

    @Get('patients/:pid/appointments')
    async findByPatient(@Param('pid') pid: string) {
        return this.appointmentsService.findByPatient(pid);
    }

    @Post('patients/:pid/appointments')
    async create(@Param('pid') pid: string, @Body() dto: CreateAppointmentDto) {
        return this.appointmentsService.create(pid, dto);
    }

    @Patch('appointments/:eid/status')
    async updateStatus(
        @Param('eid') eid: string,
        @Body() body: { status: string },
    ) {
        await this.appointmentsService.updateStatus(
            parseNumericId(eid, 'Appointment id'),
            body.status,
        );
        return { message: 'status updated' };
    }

    @Delete('patients/:pid/appointments/:eid')
    async delete(@Param('pid') pid: string, @Param('eid') eid: string) {
        await this.appointmentsService.delete(
            parseNumericId(eid, 'Appointment id'),
        );
        return { message: 'record deleted' };
    }

    /**
     * Create walk-in check-in for quick-assigned patients.
     */
    @Post('patients/:pid/walk-in')
    async createWalkIn(@Param('pid') pid: string) {
        return this.appointmentsService.createWalkInCheckin(
            parseNumericId(pid, 'Patient id'),
        );
    }
}
