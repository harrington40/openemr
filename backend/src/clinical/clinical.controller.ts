import {
  Controller, Get, Post, Put, Delete, Param, Body, Query, Req, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ClinicalService } from './clinical.service';

/**
 * Clinical data controller.
 *
 * Read access is granted to admin, physician and nurse.
 * Mutations are restricted to admin + physician — a registered nurse has
 * read-only chart access and documents care via nursing notes instead.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'physician', 'nurse')
export class ClinicalController {
  constructor(private readonly clinical: ClinicalService) {}

  // --- Medications ---
  @Get('prescriptions')
  @Roles('admin', 'physician', 'nurse', 'pharmacist')
  getAllPrescriptions() { return this.clinical.getAllPrescriptions(); }

  // --- Pharmacy alerts (provider → pharmacist notification) ---
  @Get('pharmacy/alerts')
  @Roles('admin', 'pharmacist')
  getPharmacyAlerts() { return this.clinical.getPharmacyAlerts(); }

  @Post('pharmacy/alerts/read-all')
  @Roles('admin', 'pharmacist')
  markPharmacyAlertsRead() { return this.clinical.markPharmacyAlertsRead(); }

  @Post('patients/:pid/prescriptions')
  @Roles('admin', 'physician', 'pharmacist')
  createPrescription(@Param('pid') pid: string, @Body() dto: any) {
    // Map pharmacy form fields to the medication model.
    return this.clinical.createMedication(+pid, {
      drug: dto.drug,
      dosage: dto.dosage,
      quantity: dto.quantity,
      route: dto.route || dto.frequency || '',
      refills: dto.refills,
      note: dto.note || dto.notes || '',
      start_date: dto.start_date || null,
      end_date: dto.end_date || null,
    });
  }

  @Get('patients/:pid/medications')
  getMedications(@Param('pid') pid: string) { return this.clinical.getMedications(+pid); }

  @Post('patients/:pid/medications')
  @Roles('admin', 'physician')
  createMedication(@Param('pid') pid: string, @Body() dto: any) { return this.clinical.createMedication(+pid, dto); }

  @Post('patients/:pid/medications/batch')
  @Roles('admin', 'physician')
  createMedicationsBatch(@Param('pid') pid: string, @Body() dto: any) {
    const list = Array.isArray(dto?.medications) ? dto.medications : dto;
    return this.clinical.createMedicationsBatch(+pid, list);
  }

  @Put('patients/:pid/medications/:id')
  @Roles('admin', 'physician')
  updateMedication(@Param('id') id: string, @Body() dto: any) { return this.clinical.updateMedication(+id, dto); }

  @Delete('patients/:pid/medications/:id')
  @Roles('admin', 'physician')
  deleteMedication(@Param('id') id: string) { return this.clinical.deleteMedication(+id); }

  // --- Allergies ---
  @Get('patients/:pid/allergies')
  getAllergies(@Param('pid') pid: string) { return this.clinical.getAllergies(+pid); }

  @Get('patients/:pid/allergies/enriched')
  @Roles('admin', 'physician', 'nurse')
  getEnrichedAllergies(@Param('pid') pid: string) { return this.clinical.getEnrichedAllergies(+pid); }

  @Post('patients/:pid/allergies')
  @Roles('admin', 'physician')
  createAllergy(@Param('pid') pid: string, @Body() dto: any) { return this.clinical.createAllergy(+pid, dto); }

  @Delete('patients/:pid/allergies/:id')
  @Roles('admin', 'physician')
  deleteAllergy(@Param('id') id: string) { return this.clinical.deleteAllergy(+id); }

  // --- Conditions ---
  @Get('patients/:pid/conditions')
  getConditions(@Param('pid') pid: string) { return this.clinical.getConditions(+pid); }

  @Post('patients/:pid/conditions')
  @Roles('admin', 'physician')
  createCondition(@Param('pid') pid: string, @Body() dto: any) { return this.clinical.createCondition(+pid, dto); }

  @Put('patients/:pid/conditions/:id')
  @Roles('admin', 'physician')
  updateCondition(@Param('id') id: string, @Body() dto: any) { return this.clinical.updateCondition(+id, dto); }

  @Delete('patients/:pid/conditions/:id')
  @Roles('admin', 'physician')
  deleteCondition(@Param('id') id: string) { return this.clinical.deleteCondition(+id); }

  // --- Immunizations ---
  @Get('patients/:pid/immunizations')
  getImmunizations(@Param('pid') pid: string) { return this.clinical.getImmunizations(+pid); }

  @Post('patients/:pid/immunizations')
  @Roles('admin', 'physician')
  createImmunization(@Param('pid') pid: string, @Body() dto: any) { return this.clinical.createImmunization(+pid, dto); }

  @Delete('patients/:pid/immunizations/:id')
  @Roles('admin', 'physician')
  deleteImmunization(@Param('id') id: string) { return this.clinical.deleteImmunization(+id); }

  // --- Vitals History (nurses record vitals as part of clinical workflow) ---
  @Get('patients/:pid/vitals')
  getVitalsHistory(@Param('pid') pid: string) { return this.clinical.getVitalsHistory(+pid); }

  @Post('patients/:pid/vitals')
  @Roles('admin', 'physician', 'nurse')
  createVital(@Param('pid') pid: string, @Body() dto: any) {
    return this.clinical.createVital(+pid, dto);
  }

  // --- Structured clinical observations (chart "Observations" tab) ---
  @Get('patients/:pid/observations')
  getObservations(@Param('pid') pid: string, @Query('limit') limit?: string) {
    return this.clinical.getObservations(+pid, limit ? parseInt(limit, 10) : 100);
  }

  @Post('patients/:pid/observations')
  @Roles('admin', 'physician', 'nurse', 'midwife')
  createObservation(@Param('pid') pid: string, @Body() dto: any, @Req() req: any) {
    return this.clinical.createObservation(+pid, dto, req?.user);
  }
}
