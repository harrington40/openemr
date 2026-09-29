import {
    Controller,
    Get,
    Post,
    Delete,
    Param,
    Body,
    Req,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { MidwifeService, type SaveAssessmentDto } from './midwife.service';

/** Authenticated request used by the midwife endpoints. */
interface MidwifeRequest {
    user?: {
        sub?: number | string;
        id?: number | string;
        username?: string;
        displayName?: string;
    };
}

/**
 * Structured maternity records — pregnancy risk scores, EDD calculations and
 * newborn APGAR assessments, filed against a patient's chart.
 */
@Controller('midwife')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'physician', 'midwife', 'nurse')
export class MidwifeController {
    constructor(private readonly midwife: MidwifeService) {}

    @Post('patients/:pid/assessments')
    async save(
        @Param('pid') pid: string,
        @Body() dto: SaveAssessmentDto,
        @Req() req: MidwifeRequest,
    ) {
        return this.midwife.saveAssessment(parseInt(pid, 10), dto, {
            id: Number(req.user?.sub || req.user?.id || 0) || undefined,
            name: req.user?.displayName || req.user?.username,
        });
    }

    @Get('patients/:pid/assessments')
    async list(@Param('pid') pid: string) {
        return this.midwife.listAssessments(parseInt(pid, 10));
    }

    /**
     * Whether this patient has a maternity record at all. The dashboard asks before
     * it lets an assessment be filed, so a male chart can never be selected.
     */
    @Get('patients/:pid/eligibility')
    async eligibility(@Param('pid') pid: string) {
        return this.midwife.getEligibility(parseInt(pid, 10));
    }

    @Delete('assessments/:id')
    async remove(@Param('id') id: string) {
        return this.midwife.deleteAssessment(parseInt(id, 10));
    }
}
