import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PatientChatService } from './patient-chat.service';

/** All staff roles may reach the chat endpoints; the service enforces per-patient access. */
const STAFF_ROLES = [
  'admin', 'physician', 'nurse', 'front_desk', 'midwife',
  'lab_tech', 'pharmacist', 'billing', 'inventory_manager',
];

@Controller()
export class PatientChatController {
  constructor(private readonly chat: PatientChatService) {}

  // ------------------------------------------------------------------
  // Patient portal endpoints (public — identity validated with pid+DOB)
  // ------------------------------------------------------------------

  @Post('patient-chat')
  async sendPatientMessage(
    @Body() body: { pid: number; dob?: string; body: string },
  ) {
    return this.chat.sendPatientMessage(Number(body.pid), body.dob, body.body);
  }

  @Get('patient-chat/:pid')
  async getPatientThread(
    @Param('pid') pid: string,
    @Query('dob') dob?: string,
  ) {
    return this.chat.getPatientThread(Number(pid), dob);
  }

  // ------------------------------------------------------------------
  // Provider / staff endpoints (authenticated)
  // ------------------------------------------------------------------

  @Get('chat/unread')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...STAFF_ROLES)
  async getUnread(@Req() req: any) {
    return this.chat.getUnread(req.user);
  }

  @Get('chat/patients')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...STAFF_ROLES)
  async getChatPatients(@Req() req: any) {
    return this.chat.getChatPatients(req.user);
  }

  /** Effective access level for the current user on a patient's chat. */
  @Get('chat/access/:pid')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...STAFF_ROLES)
  async getAccess(@Param('pid') pid: string, @Req() req: any) {
    return this.chat.getAccess(req.user, Number(pid));
  }

  /** Users available to share a patient chat with (admin/physician only). */
  @Get('chat/users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'physician')
  async getShareableUsers() {
    return this.chat.getShareableUsers();
  }

  /** Current shares for a patient's chat (admin/physician only). */
  @Get('chat/shares/:pid')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'physician')
  async listShares(@Param('pid') pid: string) {
    return this.chat.listShares(Number(pid));
  }

  /** Grant read or write access to a patient chat (admin/physician only). */
  @Post('chat/shares')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'physician')
  async share(@Body() body: { pid: number; userId: number; access?: string }, @Req() req: any) {
    return this.chat.shareWith(Number(body.pid), Number(body.userId), body.access || 'read', req.user?.sub ?? null);
  }

  /** Revoke a patient-chat share (admin/physician only). */
  @Delete('chat/shares/:pid/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'physician')
  async revoke(@Param('pid') pid: string, @Param('userId') userId: string) {
    return this.chat.revokeShare(Number(pid), Number(userId));
  }

  @Get('chat/thread/:pid')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...STAFF_ROLES)
  async getProviderThread(@Param('pid') pid: string, @Req() req: any) {
    return this.chat.getThreadForUser(req.user, Number(pid));
  }

  @Post('chat/thread/:pid')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...STAFF_ROLES)
  async sendProviderMessage(
    @Param('pid') pid: string,
    @Body('body') body: string,
    @Req() req: any,
  ) {
    return this.chat.sendProviderMessage(req.user, Number(pid), body);
  }

  @Post('chat/thread/:pid/read')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...STAFF_ROLES)
  async markThreadRead(@Param('pid') pid: string, @Req() req: any) {
    return this.chat.markThreadReadForUser(req.user, Number(pid));
  }
}
