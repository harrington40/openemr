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
import type { PatientNoteDto } from './nursing.service';

/** Authenticated request used by the nursing endpoints. */
interface NursingRequest {
    user?: {
        sub?: number;
        username?: string;
        displayName?: string;
    };
}

/** Body accepted when moving a patient to a room. */
interface RoomUpdateDto {
    room?: string | null;
}

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
    createNote(
        @Param('pid') pid: string,
        @Body() dto: PatientNoteDto,
        @Req() req: NursingRequest,
    ) {
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
    updateRoom(@Param('pid') pid: string, @Body() dto: RoomUpdateDto) {
        return this.nursing.updateRoom(+pid, dto?.room);
    }

    // ── Registered nurse dashboard ─────────────────────────────────────────

    @Get('nurse/dashboard')
    @Roles('admin', 'nurse')
    getDashboard(@Req() req: NursingRequest) {
        return this.nursing.getNurseDashboard(Number(req.user?.sub));
    }

    @Patch('nurse/notes/:id/read')
    @Roles('admin', 'nurse')
    markRead(@Param('id') id: string, @Req() req: NursingRequest) {
        return this.nursing.markNoteRead(Number(req.user?.sub), +id);
    }

    @Post('nurse/notes/read-all')
    @Roles('admin', 'nurse')
    markAllRead(@Req() req: NursingRequest) {
        return this.nursing.markAllNotesRead(Number(req.user?.sub));
    }
}
