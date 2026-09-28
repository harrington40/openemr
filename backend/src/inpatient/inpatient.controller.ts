import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { InpatientService } from './inpatient.service';

@Controller('inpatient')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InpatientController {
  constructor(private readonly inpatient: InpatientService) {}

  /** Live inpatient census with smart risk scoring (NEWS2) and capacity metrics. */
  @Get('overview')
  @Roles('admin', 'physician', 'nurse')
  getOverview() {
    return this.inpatient.getOverview();
  }
}
