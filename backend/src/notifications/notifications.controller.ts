import {
    Body,
    Controller,
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
import { NotificationsService } from './notifications.service';
import type {
    DrugInfoNotificationDto,
    NotificationUser,
} from './notifications.service';

/** Authenticated request used by the notification endpoints. */
interface NotificationsRequest {
    user?: NotificationUser;
}

/** Every clinical/admin role that can see notification badges. */
const READ_ROLES = [
    'admin',
    'physician',
    'nurse',
    'registered_nurse',
    'midwife',
    'lab_tech',
    'front_desk',
    'billing',
    'pharmacist',
    'inventory_manager',
];

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
    constructor(private readonly notifications: NotificationsService) {}

    /** Badge counts for the sidebar: messages, referrals, drug info, pharmacy, flow. */
    @Get('summary')
    @Roles(...READ_ROLES)
    summary(@Req() req: NotificationsRequest) {
        return this.notifications.getSummary(req.user || {});
    }

    /** Drug information notices raised from FDA lookups. */
    @Get('drug-info')
    @Roles(...READ_ROLES)
    listDrugInfo(
        @Req() req: NotificationsRequest,
        @Query('limit') limit?: string,
    ) {
        return this.notifications.listDrugInfoNotifications(
            req.user || {},
            limit ? parseInt(limit, 10) : 25,
        );
    }

    /** Raise a notice for a prescribed drug that was looked up in the FDA data. */
    @Post('drug-info')
    @Roles(
        'admin',
        'physician',
        'nurse',
        'registered_nurse',
        'midwife',
        'pharmacist',
    )
    createDrugInfo(
        @Body() dto: DrugInfoNotificationDto,
        @Req() req: NotificationsRequest,
    ) {
        return this.notifications.createDrugInfoNotification(
            req.user || {},
            dto,
        );
    }

    /** Mark a drug information notice as read. */
    @Post('drug-info/:id/ack')
    @Roles(...READ_ROLES)
    ackDrugInfo(@Param('id') id: string) {
        return this.notifications.ackDrugInfoNotification(+id);
    }
}
