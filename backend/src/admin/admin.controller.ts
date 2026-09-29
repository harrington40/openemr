import {
    Controller,
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Param,
    Query,
    Body,
    UseGuards,
    ForbiddenException,
    Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminService } from './admin.service';
import type { AdminCodeDto, UserDto } from './admin.service';
import { MessageProducer } from '../messaging/message-producer.service';
import type { Priority } from '../messaging/priority-escalation.service';
import { PatientPortalService } from '../patient-portal/patient-portal.service';

/** Authenticated request used by the admin endpoints. */
interface AdminRequest {
    user?: {
        sub?: number;
        username?: string;
        role?: string;
        can_edit_providers?: number;
    };
}

/** Body accepted when toggling a role menu permission. */
interface MenuPermissionDto {
    role: string;
    menuKey: string;
    enabled: boolean;
}

/** Body accepted by the message-producer endpoint. */
interface AdminMessageDto {
    title: string;
    body: string;
    pid?: number;
    priority?: Priority;
    messageType?: 'clinic' | 'patient' | 'direct';
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
    constructor(
        private readonly admin: AdminService,
        private readonly messageProducer: MessageProducer,
        private readonly portal: PatientPortalService,
    ) {}

    // --- Pending Registrations (admin + registrar review) ---
    @Get('admin/pending-registrations')
    @Roles('admin', 'front_desk')
    getPendingRegistrations() {
        return this.admin.getPendingRegistrations();
    }

    /**
     * Issues or reissues a patient portal password, returned once for the desk to
     * hand over, and forces a change at first sign-in.
     *
     * Portal login requires a password, so a patient who registered before that
     * became true has no credentials at all. This is how the desk gives them one
     * — and how a patient who has forgotten theirs gets back in.
     */
    @Post('admin/patients/:pid/portal-password')
    @Roles('admin', 'front_desk')
    issuePortalPassword(@Param('pid') pid: string) {
        return this.portal.issuePassword(Number(pid));
    }

    @Put('admin/users/:id/approve')
    @Roles('admin', 'front_desk')
    approveUser(@Param('id') id: string) {
        return this.admin.approveUser(+id);
    }

    @Put('admin/users/:id/reject')
    @Roles('admin', 'front_desk')
    rejectUser(@Param('id') id: string) {
        return this.admin.rejectUser(+id);
    }

    // --- Users / Providers ---
    @Get('admin/users')
    @Roles('admin', 'front_desk')
    getUsers() {
        return this.admin.getUsers();
    }

    @Get('admin/users/:id')
    @Roles('admin', 'front_desk')
    getUser(@Param('id') id: string) {
        return this.admin.getUser(+id);
    }

    @Post('admin/users')
    @Roles('admin', 'front_desk')
    async createUser(@Body() dto: UserDto, @Req() req: AdminRequest) {
        this.checkProviderEditPrivilege(req.user);
        return this.admin.createUser(dto);
    }

    @Put('admin/users/:id')
    @Roles('admin', 'front_desk')
    async updateUser(
        @Param('id') id: string,
        @Body() dto: UserDto,
        @Req() req: AdminRequest,
    ) {
        this.checkProviderEditPrivilege(req.user);
        return this.admin.updateUser(+id, dto);
    }

    @Put('admin/users/:id/provider-edit-privilege')
    @Roles('admin')
    async setProviderEditPrivilege(
        @Param('id') id: string,
        @Body('enabled') enabled: boolean,
    ) {
        return this.admin.setProviderEditPrivilege(+id, enabled);
    }

    @Put('admin/users/:id/chart-view-privilege')
    @Roles('admin')
    async setChartViewPrivilege(
        @Param('id') id: string,
        @Body('enabled') enabled: boolean,
    ) {
        return this.admin.setChartViewPrivilege(+id, enabled);
    }

    @Put('admin/users/:id/charge-edit-privilege')
    @Roles('admin')
    async setChargeEditPrivilege(
        @Param('id') id: string,
        @Body('enabled') enabled: boolean,
    ) {
        return this.admin.setChargeEditPrivilege(+id, enabled);
    }

    private checkProviderEditPrivilege(user: AdminRequest['user']): void {
        if (!user) throw new ForbiddenException('Not authenticated');
        // Admin always has the privilege
        if (user.role === 'admin') return;
        // Front desk needs explicit privilege
        if (user.role === 'front_desk') {
            if (!user.can_edit_providers) {
                throw new ForbiddenException(
                    'You do not have permission to edit providers. Please contact an administrator.',
                );
            }
        }
    }

    // --- Specialties (legacy list_options) ---
    @Get('admin/specialties')
    @Roles('admin', 'front_desk', 'physician')
    getSpecialties() {
        return this.admin.getSpecialties();
    }

    // --- Facilities ---
    @Get('facilities')
    @Roles('admin', 'front_desk', 'physician', 'nurse')
    getFacilities() {
        return this.admin.getFacilities();
    }

    @Get('facilities/:id')
    @Roles('admin', 'front_desk', 'physician', 'nurse')
    getFacility(@Param('id') id: string) {
        return this.admin.getFacility(+id);
    }

    // --- Lists ---
    @Get('admin/lists')
    @Roles('admin', 'front_desk')
    getLists() {
        return this.admin.getLists();
    }

    // --- Messages ---
    @Get('messages')
    @Roles(
        'admin',
        'physician',
        'nurse',
        'midwife',
        'lab_tech',
        'front_desk',
        'billing',
    )
    getMessages() {
        return this.admin.getMessages();
    }

    @Patch('messages/:id/read')
    @Roles(
        'admin',
        'physician',
        'nurse',
        'midwife',
        'lab_tech',
        'front_desk',
        'billing',
    )
    markMessageRead(@Param('id') id: string) {
        return this.admin.markMessageRead(parseInt(id, 10));
    }

    @Post('messages/read-all')
    @Roles(
        'admin',
        'physician',
        'nurse',
        'midwife',
        'lab_tech',
        'front_desk',
        'billing',
    )
    markAllMessagesRead() {
        return this.admin.markAllMessagesRead();
    }

    @Delete('messages/:id')
    @Roles(
        'admin',
        'physician',
        'nurse',
        'midwife',
        'lab_tech',
        'front_desk',
        'billing',
    )
    deleteMessage(@Param('id') id: string) {
        return this.admin.deleteMessage(parseInt(id, 10));
    }

    // --- Codes (CPT/ICD-10) ---
    @Get('admin/codes')
    @Roles('admin', 'physician', 'front_desk', 'billing')
    getCodes(@Query('type') type?: string) {
        return this.admin.getCodes(type);
    }

    @Post('admin/codes')
    @Roles('admin', 'front_desk', 'billing')
    createCode(@Body() dto: AdminCodeDto) {
        return this.admin.createCode(dto);
    }

    @Put('admin/codes/:code')
    @Roles('admin', 'front_desk', 'billing')
    updateCode(@Param('code') code: string, @Body() dto: AdminCodeDto) {
        return this.admin.updateCode(code, dto);
    }

    @Delete('admin/codes/:code')
    @Roles('admin', 'front_desk')
    deleteCode(@Param('code') code: string, @Query('type') codeType: string) {
        return this.admin.deleteCode(code, codeType);
    }

    /** Route message through Kafka/in-memory bus with smart routing */
    @Post('messages')
    @Roles('admin', 'physician')
    async createMessage(@Body() dto: AdminMessageDto) {
        const result = await this.messageProducer.produceMessage({
            title: dto.title,
            body: dto.body,
            pid: dto.pid,
            priority: dto.priority || 'NORMAL',
            type: dto.messageType || 'clinic',
        });
        return { success: true, eventId: result.eventId, topic: result.topic };
    }

    // ── Role-based menu access ─────────────────────────────────────────────

    @Get('admin/menu-permissions')
    @Roles('admin')
    getMenuPermissions() {
        return this.admin.getMenuPermissions();
    }

    @Put('admin/menu-permissions')
    @Roles('admin')
    async setMenuPermission(@Body() dto: MenuPermissionDto) {
        await this.admin.setMenuPermission(dto.role, dto.menuKey, dto.enabled);
        return { ok: true };
    }

    @Get('menu-permissions/:role')
    @Roles(
        'admin',
        'physician',
        'nurse',
        'front_desk',
        'midwife',
        'lab_tech',
        'billing',
        'inventory_manager',
    )
    getMenuPermissionsForRole(@Param('role') role: string) {
        return this.admin.getMenuPermissionsForRole(role);
    }
}
