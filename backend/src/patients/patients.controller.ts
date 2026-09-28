import { Controller, Get, Post, Put, Patch, Param, Query, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PatientsService, PatientRow } from './patients.service';
import type { CreatePatientDto } from './patients.service';

@Controller('patients')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'physician', 'nurse', 'front_desk', 'midwife', 'lab_tech', 'pharmacist')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get()
  async findAll(
    @Query('search') search?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sex') sex?: string,
    @Query('ageMin') ageMin?: number,
    @Query('ageMax') ageMax?: number,
  ): Promise<PatientRow[]> {
    return this.patientsService.findAll({ search, limit, offset, sex, ageMin, ageMax });
  }

  /**
   * Get patients pending approval (status = 'pending') — for registrar.
   * MUST be before @Get(':id') to avoid route collision.
   */
  @Get('pending')
  @Roles('admin', 'front_desk')
  async getPending() {
    return this.patientsService.getPendingPatients();
  }

  /**
   * Recently approved/registered patients — propagates across all dashboards.
   * MUST be before @Get(':id') to avoid route collision.
   */
  @Get('recently-approved')
  @Roles('admin', 'physician', 'nurse', 'midwife', 'lab_tech', 'front_desk', 'billing')
  async getRecentlyApproved() {
    return this.patientsService.getRecentlyApproved();
  }

  /**
   * Smart duplicate detection — check for an existing (returning) patient
   * before registering a new one. MUST be before @Get(':id').
   */
  @Get('check-duplicate')
  async checkDuplicate(
    @Query('fname') fname?: string,
    @Query('lname') lname?: string,
    @Query('DOB') DOB?: string,
    @Query('phone') phone?: string,
  ) {
    return this.patientsService.findDuplicates(fname, lname, DOB, phone);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<PatientRow> {
    return this.patientsService.findOne(parseInt(id, 10));
  }

  /** History of providers who have seen/scheduled this patient (pass the patient pid). */
  @Get(':id/attending-history')
  async attendingHistory(@Param('id') id: string) {
    return this.patientsService.getAttendingHistory(parseInt(id, 10));
  }

  @Post(':id/share-chart')
  @Roles('admin', 'physician', 'nurse')
  async shareChart(@Param('id') id: string, @Body() dto: { shared?: boolean }) {
    return this.patientsService.setChartShared(parseInt(id, 10), dto.shared !== false);
  }

  @Post()
  @Roles('admin', 'physician', 'front_desk', 'nurse')
  async create(@Body() dto: CreatePatientDto, @Req() req: any) {
    const createdBy = req.user?.username || req.user?.displayName || null;
    return this.patientsService.create(dto, createdBy);
  }

  @Patch(':id')
  @Roles('admin', 'physician', 'front_desk')
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<CreatePatientDto>,
    @Req() req: any,
  ) {
    // Pass the caller's role through: the service gates date-of-birth / name /
    // sex edits after 30 days, and without this an administrator was blocked
    // too — the tab enabled the fields while the API rejected the save.
    await this.patientsService.update(parseInt(id, 10), dto, req?.user?.role === 'admin');
    return { message: 'updated' };
  }

  /**
   * Approve a pending patient — registrar action.
   */
  @Patch(':id/approve')
  @Roles('admin', 'front_desk')
  async approvePatient(@Param('id') id: string, @Body() dto?: any) {
    return this.patientsService.approvePatient(parseInt(id, 10), dto?.providerID, {
      insuranceType: dto?.insuranceType,
      patientPercent: dto?.patientPercent,
    });
  }

  /**
   * Set a patient's insurance coverage (registrar / billing / admin).
   * Used at approval and to correct the split later for calculation purposes.
   */
  @Put('pid/:pid/insurance-coverage')
  @Roles('admin', 'front_desk', 'billing', 'physician')
  async setInsuranceCoverage(@Param('pid') pid: string, @Body() dto: any) {
    return this.patientsService.updateInsuranceCoverage(parseInt(pid, 10), dto);
  }

}
