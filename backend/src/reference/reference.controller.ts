import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ReferenceService } from './reference.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'physician', 'nurse', 'front_desk')
export class ReferenceController {
    constructor(private readonly referenceService: ReferenceService) {}

    @Get('insurance-companies')
    async getInsuranceCompanies() {
        return this.referenceService.getInsuranceCompanies();
    }

    @Get('procedures')
    async getProcedures() {
        return this.referenceService.getProcedures();
    }

    @Get('drugs')
    async getDrugs() {
        return this.referenceService.getDrugs();
    }

    @Get('patients/:pid/insurance')
    async getPatientInsurance(@Param('pid') pid: string) {
        return this.referenceService.getPatientInsurance(parseInt(pid, 10));
    }

    @Get('patients/:pid/medications')
    async getPatientMedications(@Param('pid') pid: string) {
        return this.referenceService.getPatientMedications(parseInt(pid, 10));
    }

    @Get('patients/:pid/allergies')
    async getPatientAllergies(@Param('pid') pid: string) {
        return this.referenceService.getPatientAllergies(parseInt(pid, 10));
    }
}
