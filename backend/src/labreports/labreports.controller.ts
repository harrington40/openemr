import {
    Controller,
    Get,
    Post,
    Put,
    Patch,
    Param,
    Body,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { LabReportsService } from './labreports.service';
import type {
    LabCatalogUpdateDto,
    LabReportDto,
    VerifyReportDto,
} from './labreports.service';

/** Authenticated request used by the lab-report endpoints. */
interface LabReportsRequest {
    user?: {
        sub?: number;
        username?: string;
        displayName?: string;
    };
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class LabReportsController {
    constructor(private readonly labReports: LabReportsService) {}

    // ── Database-driven test catalog ─────────────────────────────────
    @Get('lab/catalog')
    @Roles('admin', 'physician', 'nurse', 'lab_tech')
    getCatalog(@Query('category') category?: string) {
        return this.labReports.getCatalog(category);
    }

    /**
     * Update a catalog test's reference range (and wording). Admin-only, so the
     * thresholds can be maintained in the app instead of editing the seed and
     * redeploying — the reseed no longer overwrites an existing range.
     */
    @Patch('lab/catalog/:id')
    @Roles('admin')
    updateCatalogTest(
        @Param('id') id: string,
        @Body() dto: LabCatalogUpdateDto,
    ) {
        return this.labReports.updateCatalogTest(+id, dto);
    }

    /**
     * Context (patient + ordered tests + linked report) used to render the result
     * form inline inside a lab order.
     */
    @Get('lab/orders/:orderId/result-form')
    @Roles('admin', 'physician', 'nurse', 'lab_tech')
    getOrderResultForm(@Param('orderId') orderId: string) {
        return this.labReports.getOrderResultForm(+orderId);
    }

    // ── Ordered tests for a patient ──────────────────────────────────
    @Get('patients/:pid/lab/ordered-tests')
    @Roles('admin', 'physician', 'nurse', 'lab_tech')
    getOrderedTests(@Param('pid') pid: string) {
        return this.labReports.getOrderedTestNames(+pid);
    }

    // ── Reports ──────────────────────────────────────────────────────
    @Get('patients/:pid/lab-reports')
    @Roles('admin', 'physician', 'nurse', 'lab_tech')
    getReports(@Param('pid') pid: string) {
        return this.labReports.getReports(+pid);
    }

    @Post('patients/:pid/lab-reports')
    @Roles('admin', 'lab_tech')
    createReport(
        @Param('pid') pid: string,
        @Body() dto: LabReportDto,
        @Req() req: LabReportsRequest,
    ) {
        return this.labReports.createReport(+pid, {
            ...dto,
            technicianId: dto.technicianId ?? req.user?.sub ?? null,
            technicianName: dto.technicianName ?? req.user?.displayName ?? null,
        });
    }

    @Get('lab/reports/:id')
    @Roles('admin', 'physician', 'nurse', 'lab_tech')
    getReport(@Param('id') id: string) {
        return this.labReports.getReport(+id);
    }

    @Put('lab/reports/:id')
    @Roles('admin', 'lab_tech')
    updateReport(
        @Param('id') id: string,
        @Body() dto: LabReportDto,
        @Req() req: LabReportsRequest,
    ) {
        return this.labReports.updateReport(+id, dto, req.user?.sub ?? null);
    }

    @Post('lab/reports/:id/verify')
    @Roles('admin', 'lab_tech')
    verifyReport(
        @Param('id') id: string,
        @Body() dto: VerifyReportDto,
        @Req() req: LabReportsRequest,
    ) {
        return this.labReports.verifyReport(+id, dto, req.user?.sub ?? null);
    }
}
