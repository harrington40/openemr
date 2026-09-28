import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ReferralsService } from './referrals.service';

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
  create(@Body() dto: any, @Req() req: any) {
    return this.referrals.createReferral(req.user, dto);
  }

  /**
   * Referrals addressed to the signed-in provider that still need attention,
   * with the count used for the sidebar badge.
   */
  @Get('notifications')
  notifications(@Req() req: any) {
    return this.referrals.getReferralNotifications(req.user);
  }

  /** Mark a referral reviewed / accepted / declined. */
  @Post(':id/ack')
  ack(@Param('id') id: string, @Body() dto: any) {
    return this.referrals.ackReferral(+id, dto?.status);
  }
}
