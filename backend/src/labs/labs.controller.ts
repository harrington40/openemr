import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { LabsService } from './labs.service';

@Controller('lab')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'physician', 'nurse', 'lab_tech')
export class LabDashboardController {
  constructor(private readonly labs: LabsService) {}

  @Get('orders')
  @Roles('admin', 'lab_tech')
  getAllOrders() { return this.labs.getAllOrders(); }

  @Patch('orders/:id/status')
  @Roles('admin', 'lab_tech')
  updateOrderStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.labs.updateOrderStatus(+id, status);
  }

  @Post('orders/:id/validate')
  @Roles('admin', 'lab_tech')
  validateOrder(@Param('id') id: string, @Req() req: any) {
    return this.labs.validateOrder(+id, req.user?.sub);
  }

  @Post('orders/:id/results')
  @Roles('admin', 'lab_tech')
  createOrderResults(@Param('id') id: string, @Body() dto: any) {
    return this.labs.createOrderResults(+id, dto.results || dto);
  }

  @Post('orders/:id/refer')
  @Roles('admin', 'lab_tech')
  referOrder(@Param('id') id: string, @Body() dto: any) {
    return this.labs.referOrder(+id, dto);
  }

  /**
   * Code-authorized deletion of a result already filed in the patient chart
   * (validated/verified). Lab staff and providers may delete with a one-time
   * code an admin issued to them; admins may also use the master code. The code
   * is verified against the caller's identity in the service.
   */
  @Post('results/:id/authorized-delete')
  @Roles('admin', 'lab_tech', 'physician')
  deleteAuthorizedResult(@Param('id') id: string, @Body('code') code: string, @Req() req: any) {
    return this.labs.authorizedDeleteResult(+id, String(code ?? ''), req.user?.sub, req.user?.role);
  }

  // ── Admin-issued lab deletion authorizations ─────────────────────
  // The admin dashboard generates a one-time code for a lab user/provider, who
  // then enters it to remove a validated result from the patient chart.

  @Post('delete-authorizations')
  @Roles('admin')
  issueDeleteAuthorization(@Body() dto: any, @Req() req: any) {
    return this.labs.issueDeleteAuthorization(dto, req.user);
  }

  @Get('delete-authorizations')
  @Roles('admin')
  listDeleteAuthorizations() { return this.labs.listDeleteAuthorizations(); }

  @Delete('delete-authorizations/:id')
  @Roles('admin')
  revokeDeleteAuthorization(@Param('id') id: string) {
    return this.labs.revokeDeleteAuthorization(+id);
  }

  @Get('billing-codes')
  @Roles('admin', 'billing', 'physician', 'lab_tech', 'front_desk', 'nurse', 'midwife', 'pharmacist', 'inventory_manager')
  getLabBillingInfo() { return this.labs.getLabBillingInfo(); }

  // ── Group validation (per patient, one shot) ─────────────────────

  /**
   * Preview a patient's whole lab group: every open order with its results,
   * plus the provider the notification will be routed to.
   */
  @Get('patients/:pid/validation-preview')
  @Roles('admin', 'physician', 'nurse', 'lab_tech')
  getValidationPreview(@Param('pid') pid: string) {
    return this.labs.getValidationPreview(+pid);
  }

  /**
   * Validate every ready order for the patient in one shot and notify the
   * ordering provider (or the patient's assigned provider).
   */
  @Post('patients/:pid/validate-all')
  @Roles('admin', 'lab_tech')
  validatePatientGroup(@Param('pid') pid: string, @Body() dto: any, @Req() req: any) {
    return this.labs.validatePatientGroup(+pid, req.user?.sub, dto || {});
  }

  /** Patient-scoped lab results for the patient chart. */
  @Get('patients/:pid/results')
  @Roles('admin', 'physician', 'nurse', 'lab_tech')
  getPatientLabResults(@Param('pid') pid: string, @Query('limit') limit?: string) {
    return this.labs.getPatientLabResults(+pid, limit ? parseInt(limit, 10) : 100);
  }
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class LabsController {
  constructor(private readonly labs: LabsService) {}

  @Get('patients/:pid/procedures')
  @Roles('admin', 'physician', 'nurse', 'lab_tech')
  getPatientOrders(@Param('pid') pid: string) { return this.labs.getPatientOrders(+pid); }

  @Post('patients/:pid/procedures')
  @Roles('admin', 'physician', 'nurse', 'lab_tech')
  createOrder(@Param('pid') pid: string, @Body() dto: any, @Req() req: any) {
    // Auto-detect provider from JWT if not in body
    if (!dto.provider_id && req.user?.sub) {
      dto.provider_id = req.user.sub;
    }
    return this.labs.createOrder(+pid, dto);
  }

  @Get('procedures/:id/results')
  @Roles('admin', 'physician', 'nurse', 'lab_tech')
  getResults(@Param('id') id: string) { return this.labs.getResults(+id); }

  @Get('labs/results')
  @Roles('admin', 'physician', 'nurse', 'lab_tech')
  getRecentResults(@Query('limit') limit?: string) {
    return this.labs.getRecentResults(limit ? parseInt(limit, 10) : 20);
  }

  @Post('labs/results')
  @Roles('admin', 'lab_tech')
  createQuickResult(@Body() dto: any) {
    return this.labs.createQuickResult(dto);
  }

  @Post('procedures/:id/results')
  @Roles('admin', 'lab_tech')
  createResult(@Param('id') id: string, @Body() dto: any) { return this.labs.createResult(+id, dto); }

  /** Edit a single lab result in place (value, units, range, comments). */
  @Patch('procedures/results/:id')
  @Roles('admin', 'lab_tech')
  updateResult(@Param('id') id: string, @Body() dto: any) {
    return this.labs.updateResult(+id, dto);
  }

  /** Delete a single lab result. */
  @Delete('procedures/results/:id')
  @Roles('admin', 'lab_tech')
  deleteResult(@Param('id') id: string) {
    return this.labs.deleteResult(+id);
  }

  // Provider-specific lab orders — uses JWT user ID
  @Get('provider/lab-orders')
  @Roles('admin', 'physician')
  getProviderLabOrders(@Req() req: any) {
    const providerId = req.user?.sub || 0;
    return this.labs.getProviderLabOrders(providerId);
  }

  // ── Provider lab notifications ("results ready to view") ─────────

  /**
   * Lab alerts for the signed-in provider: unread "results ready" notes plus
   * the validated orders behind them (ordering provider OR assigned provider).
   */
  @Get('provider/lab-notifications')
  @Roles('admin', 'physician', 'nurse', 'lab_tech')
  getProviderLabNotifications(@Req() req: any) {
    return this.labs.getProviderLabNotifications(req.user?.sub || 0);
  }

  /** Acknowledge (mark read) a lab notification. */
  @Post('provider/lab-notifications/:id/ack')
  @Roles('admin', 'physician', 'nurse')
  ackProviderLabNotification(@Param('id') id: string) {
    return this.labs.ackProviderLabNotification(+id);
  }
}
