import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { TriageDto } from './emergency.service';
import { EmergencyService } from './emergency.service';
import { EmergencySchedulerService } from './emergency-scheduler.service';

/** Authenticated request used by the emergency endpoints. */
interface EmergencyRequest {
    user?: {
        sub?: number | string;
        id?: number | string;
        username?: string;
        displayName?: string;
    };
}

/** Body accepted when moving an attendance through its workflow. */
interface VisitStatusDto {
    status?: string;
    room?: string | null;
    providerId?: number | null;
    disposition?: string | null;
}

/**
 * Emergency department triage: score a presentation, keep the colour-coded
 * queue, and measure the journey from the door to a decision.
 */
@Controller('emergency')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmergencyController {
    constructor(
        private readonly emergency: EmergencyService,
        private readonly scheduler: EmergencySchedulerService,
    ) {}

    /** The live department, sickest and most overdue first. */
    @Get('board')
    @Roles('admin', 'physician', 'nurse', 'midwife', 'front_desk')
    getBoard() {
        return this.emergency.getBoard();
    }

    @Get('stats')
    @Roles('admin', 'physician', 'nurse', 'midwife')
    getStats(@Query('days') days?: string) {
        return this.emergency.getStats(days ? parseInt(days, 10) : 7);
    }

    @Get('escalations')
    @Roles('admin', 'physician', 'nurse', 'midwife')
    getEscalationLog(@Query('limit') limit?: string) {
        return this.emergency.getEscalationLog(
            limit ? parseInt(limit, 10) : 25,
        );
    }

    /** Dry run: what level would this be? Writes nothing. */
    @Post('patients/:pid/preview')
    @Roles('admin', 'physician', 'nurse', 'midwife', 'front_desk')
    preview(@Param('pid') pid: string, @Body() dto: TriageDto) {
        return this.emergency.preview(parseInt(pid, 10), dto || {});
    }

    /** Record an emergency attendance and triage it. */
    @Post('patients/:pid/triage')
    @Roles('admin', 'physician', 'nurse', 'midwife', 'front_desk')
    triage(
        @Param('pid') pid: string,
        @Body() dto: TriageDto,
        @Req() req: EmergencyRequest,
    ) {
        return this.emergency.triage(parseInt(pid, 10), dto || {}, {
            id: Number(req?.user?.sub || req?.user?.id || 0) || undefined,
            name: req?.user?.displayName || req?.user?.username,
        });
    }

    @Get('patients/:pid')
    @Roles('admin', 'physician', 'nurse', 'midwife', 'front_desk', 'lab_tech')
    getForPatient(@Param('pid') pid: string) {
        return this.emergency.getForPatient(parseInt(pid, 10));
    }

    @Get('visits/:id')
    @Roles('admin', 'physician', 'nurse', 'midwife', 'front_desk')
    getVisit(@Param('id') id: string) {
        return this.emergency.getVisit(parseInt(id, 10));
    }

    @Post('visits/:id/reassess')
    @Roles('admin', 'physician', 'nurse', 'midwife')
    reassess(
        @Param('id') id: string,
        @Body() dto: TriageDto & { note?: string; overrideReason?: string },
        @Req() req: EmergencyRequest,
    ) {
        return this.emergency.reassess(parseInt(id, 10), dto || {}, {
            id: Number(req?.user?.sub || req?.user?.id || 0) || undefined,
            name: req?.user?.displayName || req?.user?.username,
        });
    }

    @Patch('visits/:id/status')
    @Roles('admin', 'physician', 'nurse', 'midwife', 'front_desk')
    updateStatus(
        @Param('id') id: string,
        @Body() dto: VisitStatusDto,
        @Req() req: EmergencyRequest,
    ) {
        return this.emergency.updateStatus(parseInt(id, 10), dto || {}, {
            id: Number(req?.user?.sub || req?.user?.id || 0) || undefined,
            name: req?.user?.displayName || req?.user?.username,
        });
    }

    /**
     * Escalate every waiting patient who is past their target, and chase any
     * missed reassessment — the same sweep the 5-minute scheduler runs, so the
     * button and the timer can never drift apart.
     */
    @Post('escalate-overdue')
    @Roles('admin', 'physician')
    escalateOverdue(@Req() req: EmergencyRequest) {
        return this.scheduler.sweep(req?.user?.username || 'admin');
    }

    /** Scheduling status, so the UI can say when the last sweep ran. */
    @Get('sweep/status')
    @Roles('admin', 'physician', 'nurse', 'midwife')
    sweepStatus() {
        return {
            intervalMinutes: 5,
            description:
                'Escalates anyone past their target and chases missed reassessments; also runs 2 minutes after startup.',
            lastSweepAt: this.scheduler.lastSweepAt,
            lastSweepResult: this.scheduler.lastSweepResult,
        };
    }
}
