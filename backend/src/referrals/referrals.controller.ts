import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ReferralsService } from './referrals.service';
import type { CreateReferralDto, ReferralUser } from './referrals.service';

/** Authenticated request used by the referral endpoints. */
interface ReferralsRequest {
    user: ReferralUser;
}

/** Body accepted when acknowledging a referral. */
interface AckReferralDto {
    status?: string;
}

@Controller('referrals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'physician', 'nurse', 'front_desk', 'midwife')
export class ReferralsController {
    constructor(private readonly referrals: ReferralsService) {}

    /** Smart suggestion for a patient: conditions, clinical notes, matched specialists. */
    @Get('smart-suggest/:pid')
    smartSuggest(@Param('pid') pid: string) {
        return this.referrals.smartSuggest(Number(pid));
    }

    /** List referrals, newest first. */
    @Get()
    list() {
        return this.referrals.listReferrals();
    }

    /** Create a referral. */
    @Post()
    create(@Body() dto: CreateReferralDto, @Req() req: ReferralsRequest) {
        return this.referrals.createReferral(req.user, dto);
    }

    /**
     * Referrals addressed to the signed-in provider that still need attention,
     * with the count used for the sidebar badge.
     */
    @Get('notifications')
    notifications(@Req() req: ReferralsRequest) {
        return this.referrals.getReferralNotifications(req.user);
    }

    /** Mark a referral reviewed / accepted / declined. */
    @Post(':id/ack')
    ack(@Param('id') id: string, @Body() dto: AckReferralDto) {
        return this.referrals.ackReferral(+id, dto?.status);
    }
}
