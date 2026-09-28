import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EmergencyService } from './emergency.service';

/**
 * The emergency safety sweep.
 *
 * Every few minutes: escalate anyone who has waited past their target (which
 * also pages their nurse) and chase observations that have gone past their
 * level's reassessment interval. This is the part of the design that rescues a
 * neglected patient — the queue order deliberately never lets waiting time
 * outrank a sicker patient, so being overlooked has to be *noticed*, not
 * silently reordered.
 *
 * Ticks every 5 minutes rather than the 15 used by the billing and mailbox jobs:
 * a 10-minute target has a 5-minute grace, so a 15-minute tick could leave a
 * chest-pain patient sitting ~20 minutes past their target before anyone is
 * told. The check is a single indexed query, and both actions are guarded per
 * visit, so a frequent tick cannot escalate or page twice.
 *
 * Style mirrors `BillingIntegrityService` / `MailboxSchedulerService`: a
 * dependency-free interval plus a boot check. @nestjs/schedule is not installed
 * and the deploy ships dist/ only.
 */
@Injectable()
export class EmergencySchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmergencySchedulerService.name);
  private timer?: NodeJS.Timeout;
  private bootTimer?: NodeJS.Timeout;
  private running = false;

  /** Last sweep, surfaced so the board can show that the safety net is alive. */
  lastSweepAt: string | null = null;
  lastSweepResult: any = null;

  private static readonly INTERVAL_MS = 5 * 60 * 1000;

  constructor(private readonly emergency: EmergencyService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => { void this.sweep('scheduler'); }, EmergencySchedulerService.INTERVAL_MS);
    this.bootTimer = setTimeout(() => { void this.sweep('startup'); }, 120 * 1000);
    this.logger.log('Emergency safety sweep armed (breach escalation + reassessment chase).');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
  }

  /** Exposed so an administrator can trigger the same sweep on demand. */
  async sweep(actor = 'scheduler') {
    if (this.running) return { ran: false, reason: 'a sweep is already running' };
    this.running = true;
    try {
      const result = await this.emergency.runSafetySweep(actor);
      const escalated = result.escalated?.length || 0;
      const chased = result.reassessmentPages?.length || 0;
      this.lastSweepAt = new Date().toISOString();
      this.lastSweepResult = {
        checked: result.checked,
        escalated,
        reassessmentPages: chased,
        by: actor,
      };
      if (escalated || chased) {
        this.logger.warn(
          `Emergency sweep: ${escalated} escalated past target, ${chased} reassessment${chased === 1 ? '' : 's'} chased.`,
        );
      }
      return { ran: true, ...result };
    } catch (err: any) {
      // A failed sweep must not kill the timer.
      this.logger.error(`Emergency sweep failed: ${err?.message || err}`);
      return { ran: false, reason: 'error' };
    } finally {
      this.running = false;
    }
  }
}
