import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'physician')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('appointments')
  appointmentStats(@Query('startDate') start?: string, @Query('endDate') end?: string) {
    return this.reports.appointmentStats(start, end);
  }

  @Get('encounters')
  encounterStats(@Query('startDate') start?: string, @Query('endDate') end?: string) {
    return this.reports.encounterStats(start, end);
  }

  @Get('patients')
  patientStats(@Query('startDate') start?: string, @Query('endDate') end?: string) {
    return this.reports.patientStats(start, end);
  }

  @Get('financial')
  financialStats() { return this.reports.financialStats(); }
}
