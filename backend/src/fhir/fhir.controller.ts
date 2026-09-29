import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FhirService } from './fhir.service';

@Controller('fhir')
@UseGuards(JwtAuthGuard)
export class FhirController {
    constructor(private readonly fhir: FhirService) {}

    @Get('Patient')
    searchPatients(@Query('name') name?: string) {
        return this.fhir.searchPatients(name);
    }

    @Get('Patient/:id')
    getPatient(@Param('id') id: string) {
        return this.fhir.getPatient(+id);
    }

    @Get('Observation')
    getObservations(@Query('patient') patient?: string) {
        if (!patient)
            return {
                resourceType: 'Bundle',
                type: 'searchset',
                total: 0,
                entry: [],
            };
        return this.fhir.getObservations(+patient);
    }

    @Get('Condition')
    getConditions(@Query('patient') patient?: string) {
        if (!patient)
            return {
                resourceType: 'Bundle',
                type: 'searchset',
                total: 0,
                entry: [],
            };
        return this.fhir.getConditions(+patient);
    }

    @Get('MedicationRequest')
    getMedicationRequests(@Query('patient') patient?: string) {
        if (!patient)
            return {
                resourceType: 'Bundle',
                type: 'searchset',
                total: 0,
                entry: [],
            };
        return this.fhir.getMedicationRequests(+patient);
    }

    @Get('AllergyIntolerance')
    getAllergyIntolerances(@Query('patient') patient?: string) {
        if (!patient)
            return {
                resourceType: 'Bundle',
                type: 'searchset',
                total: 0,
                entry: [],
            };
        return this.fhir.getAllergyIntolerances(+patient);
    }

    @Get('Immunization')
    getImmunizations(@Query('patient') patient?: string) {
        if (!patient)
            return {
                resourceType: 'Bundle',
                type: 'searchset',
                total: 0,
                entry: [],
            };
        return this.fhir.getImmunizations(+patient);
    }

    @Get('Encounter')
    getEncounters(@Query('patient') patient?: string) {
        if (!patient)
            return {
                resourceType: 'Bundle',
                type: 'searchset',
                total: 0,
                entry: [],
            };
        return this.fhir.getEncounters(+patient);
    }
}
