import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { NursingService } from './nursing.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class NursingController {
  constructor(private readonly nursing: NursingService) {}

  // ── Patient notes (chart + screening integration) ──────────────────────

  @Get('patients/:pid/notes')
  @Roles('admin', 'physician', 'nurse')
  getNotes(@Param('pid') pid: string) {
    return this.nursing.getPatientNotes(+pid);
  }

  @Post('patients/:pid/notes')
  @Roles('admin', 'physician', 'nurse')
  createNote(@Param('pid') pid: string, @Body() dto: any, @Req() req: any) {
    return this.nursing.createPatientNote(+pid, dto, {
      id: req.user?.sub,
      username: req.user?.username || 'provider',
      displayName: req.user?.displayName,
    });
  }

  // ── Room assignment ────────────────────────────────────────────────────

  @Get('patients/:pid/room')
  @Roles('admin', 'physician', 'nurse')
  getRoom(@Param('pid') pid: string) {
    return this.nursing.getRoom(+pid);
  }

  @Patch('patients/:pid/room')
  @Roles('admin', 'physician', 'nurse')
  updateRoom(@Param('pid') pid: string, @Body() dto: any) {
    return this.nursing.updateRoom(+pid, dto?.room);
  }

  // ── Registered nurse dashboard ─────────────────────────────────────────

  @Get('nurse/dashboard')
  @Roles('admin', 'nurse')
  getDashboard(@Req() req: any) {
    return this.nursing.getNurseDashboard(req.user?.sub);
  }

  @Patch('nurse/notes/:id/read')
  @Roles('admin', 'nurse')
  markRead(@Param('id') id: string, @Req() req: any) {
    return this.nursing.markNoteRead(req.user?.sub, +id);
  }

  @Post('nurse/notes/read-all')
  @Roles('admin', 'nurse')
  markAllRead(@Req() req: any) {
    return this.nursing.markAllNotesRead(req.user?.sub);
  }
}
