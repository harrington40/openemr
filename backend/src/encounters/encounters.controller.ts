import {
    Controller,
    Get,
    Post,
    Put,
    Param,
    Body,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { EncountersService } from './encounters.service';
import type {
    SoapNoteDto,
    ClinicalNoteDto,
    CarePlanDto,
} from './encounters.service';
import type { CreateEncounterDto } from './encounters.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'physician', 'nurse')
export class EncountersController {
    constructor(private readonly encountersService: EncountersService) {}

    @Get('patients/:pid/encounters')
    async findByPatient(@Param('pid') pid: string) {
        return this.encountersService.findByPatient(parseInt(pid, 10));
    }

    @Get('patients/:pid/encounters/:eid')
    async findOne(@Param('pid') pid: string, @Param('eid') eid: string) {
        return this.encountersService.findOne(
            parseInt(pid, 10),
            parseInt(eid, 10),
        );
    }

    @Post('patients/:pid/encounters')
    async create(@Param('pid') pid: string, @Body() dto: CreateEncounterDto) {
        return this.encountersService.create(parseInt(pid, 10), dto);
    }

    @Put('patients/:pid/encounters/:eid')
    async update(
        @Param('pid') pid: string,
        @Param('eid') eid: string,
        @Body() dto: Partial<CreateEncounterDto>,
    ) {
        await this.encountersService.update(
            parseInt(pid, 10),
            parseInt(eid, 10),
            dto,
        );
        return { message: 'updated' };
    }

    // --- Vitals ---

    @Get('patients/:pid/encounters/:eid/vitals')
    async getVitals(@Param('pid') pid: string, @Param('eid') eid: string) {
        return this.encountersService.getVitals(
            parseInt(pid, 10),
            parseInt(eid, 10),
        );
    }

    @Post('patients/:pid/encounters/:eid/vitals')
    async createVital(
        @Param('pid') pid: string,
        @Param('eid') eid: string,
        @Body() dto: Record<string, unknown>,
    ) {
        return this.encountersService.createVital(
            parseInt(pid, 10),
            parseInt(eid, 10),
            dto,
        );
    }

    // --- SOAP Notes ---

    @Get('patients/:pid/encounters/:eid/soap')
    getSoapNotes(@Param('pid') pid: string, @Param('eid') eid: string) {
        return this.encountersService.getSoapNotes(+pid, +eid);
    }

    @Post('patients/:pid/encounters/:eid/soap')
    createSoap(
        @Param('pid') pid: string,
        @Param('eid') eid: string,
        @Body() dto: SoapNoteDto,
    ) {
        return this.encountersService.createSoap(+pid, +eid, dto);
    }

    @Put('patients/:pid/encounters/:eid/soap/:id')
    updateSoap(@Param('id') id: string, @Body() dto: SoapNoteDto) {
        return this.encountersService.updateSoap(+id, dto);
    }

    // --- Review of Systems ---

    @Get('patients/:pid/ros')
    getRos(@Param('pid') pid: string) {
        return this.encountersService.getRos(+pid);
    }

    @Post('patients/:pid/ros')
    createRos(@Param('pid') pid: string, @Body() dto: Record<string, unknown>) {
        return this.encountersService.createRos(+pid, dto);
    }

    // --- Clinical Notes ---

    @Get('patients/:pid/encounters/:eid/notes')
    getClinicalNotes(@Param('pid') pid: string, @Param('eid') eid: string) {
        return this.encountersService.getClinicalNotes(+pid, +eid);
    }

    @Post('patients/:pid/encounters/:eid/notes')
    createClinicalNote(
        @Param('pid') pid: string,
        @Param('eid') eid: string,
        @Body() dto: ClinicalNoteDto,
    ) {
        return this.encountersService.createClinicalNote(+pid, +eid, dto);
    }

    // --- Care Plan ---

    @Get('patients/:pid/care-plan')
    getCarePlan(@Param('pid') pid: string) {
        return this.encountersService.getCarePlan(+pid);
    }

    @Post('patients/:pid/care-plan')
    createCarePlan(@Param('pid') pid: string, @Body() dto: CarePlanDto) {
        return this.encountersService.createCarePlan(+pid, dto);
    }
}
