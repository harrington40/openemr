import { Controller, Get, Post, Put, Delete, Param, Query, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { MailboxService } from './mailbox.service';
import { MailboxSchedulerService } from './mailbox-scheduler.service';

/**
 * Smart mailbox: the internal `pnotes` inbox, triaged, threaded, and backed by
 * Backblaze B2 once mail is old enough to leave the hot list.
 */
@Controller('mailbox')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MailboxController {
  constructor(
    private readonly mailbox: MailboxService,
    private readonly scheduler: MailboxSchedulerService,
  ) {}

  @Get()
  @Roles('admin', 'physician', 'nurse', 'midwife', 'lab_tech', 'front_desk', 'billing')
  getInbox(
    @Query('folder') folder?: string,
    @Query('priority') priority?: string,
    @Query('category') category?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.mailbox.getInbox({
      folder: (folder as any) || 'inbox',
      priority,
      category,
      q,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      unreadOnly: unreadOnly === 'true',
    });
  }

  @Get('stats')
  @Roles('admin', 'physician', 'nurse', 'midwife', 'lab_tech', 'front_desk', 'billing')
  getStats() {
    return this.mailbox.getStats();
  }

  /** Dry run by default (`dryRun: true`) so the UI can preview before moving mail. */
  @Post('archive/preview')
  @Roles('admin', 'physician')
  previewArchive(@Body() dto: any) {
    return this.mailbox.previewArchive(dto || {});
  }

  // ── Automatic cold storage ──────────────────────────────────

  /** Everyone who can read the mailbox may see whether it self-empties, and why. */
  @Get('policy')
  @Roles('admin', 'physician', 'nurse', 'midwife', 'lab_tech', 'front_desk', 'billing')
  getPolicy() {
    return this.scheduler.getPolicy();
  }

  @Put('policy')
  @Roles('admin')
  setPolicy(@Body() dto: any) {
    return this.scheduler.setPolicy(dto || {});
  }

  /** Sweep now instead of waiting for tonight's window. */
  @Post('policy/run-now')
  @Roles('admin')
  runNow(@Req() req: any) {
    return this.scheduler.runNow(req?.user?.username || 'admin');
  }

  @Post('archive')
  @Roles('admin', 'physician')
  archive(@Body() dto: any, @Req() req: any) {
    return this.mailbox.archive(dto || {}, req?.user?.username || 'system');
  }

  @Get('archives')
  @Roles('admin', 'physician', 'nurse', 'midwife')
  listArchives() {
    return this.mailbox.listArchives();
  }

  @Get('archives/:id/download')
  @Roles('admin', 'physician', 'nurse')
  archiveDownloadUrl(@Param('id') id: string) {
    return this.mailbox.archiveDownloadUrl(parseInt(id, 10));
  }

  @Post('archives/:id/restore')
  @Roles('admin', 'physician')
  restore(@Param('id') id: string, @Req() req: any) {
    return this.mailbox.restore(parseInt(id, 10), req?.user?.username || 'system');
  }

  @Delete('archives/:id')
  @Roles('admin')
  deleteArchive(@Param('id') id: string) {
    return this.mailbox.deleteArchive(parseInt(id, 10));
  }

  @Post('thread/read')
  @Roles('admin', 'physician', 'nurse', 'midwife', 'lab_tech', 'front_desk', 'billing')
  markThreadRead(@Body() dto: { ids?: number[] }) {
    return this.mailbox.markThreadRead(dto?.ids || []);
  }
}
