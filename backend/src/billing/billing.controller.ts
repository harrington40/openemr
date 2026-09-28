import { Controller, Get, Post, Put, Delete, Param, Query, Body, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BillingService } from './billing.service';
import { BillingIntegrityService } from './billing-integrity.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly integrity: BillingIntegrityService,
  ) {}

  // ─── Patient billing summary ──────────────────────────────────
  @Get('patients/:pid/billing')
  @Roles('admin', 'billing', 'physician', 'front_desk')
  getSummary(@Param('pid') pid: string) {
    return this.billing.getPatientBillingSummary(+pid);
  }

  @Get('patients/:pid/transactions')
  @Roles('admin', 'billing', 'physician', 'front_desk')
  getTransactions(@Param('pid') pid: string) {
    return this.billing.getTransactions(+pid);
  }

  @Post('patients/:pid/transactions')
  @Roles('admin', 'billing')
  createTransaction(@Param('pid') pid: string, @Body() dto: any) {
    return this.billing.createTransaction(+pid, dto);
  }

  @Get('claims')
  @Roles('admin', 'billing', 'physician', 'front_desk')
  getClaims(@Query('pid') pid?: string) {
    return this.billing.getClaims(pid ? +pid : undefined);
  }

  // ─── Billing Specialist Dashboard ──────────────────────────────

  @Get('billing/patients')
  @Roles('admin', 'billing', 'front_desk', 'physician', 'nurse', 'midwife', 'lab_tech', 'pharmacist', 'inventory_manager')
  getBillingPatients(@Query('search') search?: string) {
    return this.billing.getBillingPatients(search);
  }

  @Get('billing/patients/:pid/clearance')
  @Roles('admin', 'billing', 'front_desk', 'physician', 'nurse', 'midwife', 'lab_tech', 'pharmacist', 'inventory_manager')
  getFinancialClearance(@Param('pid') pid: string) {
    return this.billing.getFinancialClearance(+pid);
  }

  @Post('billing/patients/:pid/discharge')
  @Roles('admin', 'billing')
  async processDischarge(
    @Param('pid') pid: string,
    @Body('dischargedBy') dischargedBy: string,
    @Req() req: any,
  ) {
    const by = dischargedBy || req.user?.displayName || req.user?.username || 'billing';
    return this.billing.processDischarge(+pid, by);
  }

  @Get('patients/:pid/discharge-summary')
  @Roles('admin', 'billing', 'physician')
  getDischargeDocument(@Param('pid') pid: string) {
    return this.billing.getDischargeDocument(+pid);
  }

  @Post('patients/:pid/discharge-summary/sync')
  @Roles('admin', 'billing', 'physician')
  async syncDischargeToDocuments(@Param('pid') pid: string, @Req() req: any) {
    const doc = await this.billing.getDischargeDocument(+pid);
    // Create a document record in the documents table
    const patient = doc.patient;
    const name = patient ? `${patient.fname || ''} ${patient.lname || ''}`.trim() : `Patient #${pid}`;
    const title = `Discharge Summary — ${name} — ${new Date().toLocaleDateString()}`;

    // Store document metadata
    const result = await (this.billing as any).dataSource?.query?.(
      `INSERT INTO documents (type, url, name, date, foreign_id, mimetype, docdate)
       VALUES ('discharge_summary', ?, ?, NOW(), ?, 'application/json', NOW())`,
      [`/api/patients/${pid}/discharge-summary`, title, pid],
    ).catch(() => ({ insertId: 0 }));

    return {
      success: true,
      message: 'Discharge summary synced to documents',
      documentId: result?.insertId || 0,
      document: doc,
    };
  }

  @Get('billing/stats')
  @Roles('admin', 'billing', 'front_desk', 'physician', 'nurse', 'midwife', 'lab_tech', 'pharmacist', 'inventory_manager')
  getBillingStats() {
    return this.billing.getBillingStats();
  }

  // ─── Auto-Calculation ───────────────────────────────────────────

  @Get('billing/auto-calculate/:pid')
  @Roles('admin', 'billing', 'physician', 'front_desk')
  autoCalculatePatient(@Param('pid') pid: string) {
    return this.billing.autoCalculatePatient(+pid);
  }

  @Get('billing/auto-calculate/:pid/encounter/:eid')
  @Roles('admin', 'billing', 'physician', 'front_desk')
  autoCalculateEncounter(@Param('pid') pid: string, @Param('eid') eid: string) {
    return this.billing.autoCalculateEncounter(+pid, +eid);
  }

  // ─── Payment + Receipt ──────────────────────────────────────────

  @Post('billing/patients/:pid/pay')
  @Roles('admin', 'billing', 'front_desk')
  async recordPayment(
    @Param('pid') pid: string,
    @Body() body: { amountUSD: number; paymentMethod: string; override?: boolean },
    @Req() req: any,
  ) {
    const receivedBy = req.user?.displayName || req.user?.username || 'Billing';
    return this.billing.recordPayment(
      +pid,
      body.amountUSD || 0,
      body.paymentMethod || 'Cash',
      receivedBy,
      !!body.override,
    );
  }

  @Get('billing/receipt/:paymentId')
  @Roles('admin', 'billing', 'front_desk', 'physician')
  getReceipt(@Param('paymentId') paymentId: string) {
    return this.billing.getReceipt(paymentId);
  }

  @Post('billing/patients/:pid/receipt')
  @Roles('admin', 'billing', 'front_desk')
  async generateReceipt(
    @Param('pid') pid: string,
    @Body() body: { amountUSD: number; paymentMethod: string },
    @Req() req: any,
  ) {
    const amountUSD = body.amountUSD || 0;
    const amountLRD = Math.round(amountUSD * 193);
    const receivedBy = req.user?.displayName || req.user?.username || 'Billing';
    return this.billing.generateReceipt(
      +pid,
      amountUSD,
      amountLRD,
      body.paymentMethod || 'Cash',
      receivedBy,
    );
  }

  // ─── Triage Intake Billing ──────────────────────────────────────

  @Post('billing/triage-intake')
  @Roles('admin', 'nurse', 'front_desk')
  billTriageIntake(@Body() body: { pid: number }) {
    return this.billing.billTriageIntake(Number(body.pid) || 0);
  }

  // ─── Billing currency settings (system-wide) ─────────────────────

  @Get('billing/settings')
  @Roles('admin', 'billing', 'physician')
  getBillingSettings() {
    return this.billing.getBillingSettings();
  }

  @Put('billing/settings')
  @Roles('admin')
  setBillingSettings(@Body() dto: any) {
    return this.billing.setBillingSettings(dto);
  }

  // ─── Auto-Bill from Screening ───────────────────────────────────

  @Post('billing/encounters/:eid/auto-bill')
  @Roles('admin', 'physician', 'nurse', 'front_desk')
  async autoBillEncounter(
    @Param('eid') eid: string,
    @Body() body: { pid: number; template?: string; labTests?: string[]; imaging?: string[]; providerId?: number },
  ) {
    return this.billing.autoBillEncounter(
      body.pid || 0,
      +eid,
      {
        template: body.template,
        labTests: body.labTests,
        imaging: body.imaging,
        providerId: body.providerId,
      },
    );
  }

  // ─── Price Catalog (admin + billing editable charges) ────────────

  @Get('billing/price-catalog')
  @Roles('admin', 'billing', 'physician', 'front_desk', 'nurse', 'midwife', 'lab_tech', 'pharmacist', 'inventory_manager')
  getPriceCatalog() {
    return this.billing.getPriceCatalog();
  }

  @Post('billing/price-catalog/suggest')
  @Roles('admin', 'billing', 'physician', 'front_desk')
  suggestPrice(@Body() dto: any, @Req() req: any) {
    this.assertCanEditCharges(req.user);
    return this.billing.suggestPrice(dto);
  }

  @Post('billing/price-catalog')
  @Roles('admin', 'billing', 'physician', 'front_desk')
  createPriceCatalogItem(@Body() dto: any, @Req() req: any) {
    this.assertCanEditCharges(req.user);
    return this.billing.createPriceCatalogItem(dto);
  }

  @Put('billing/price-catalog/:id')
  @Roles('admin', 'billing', 'physician', 'front_desk')
  updatePriceCatalogItem(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    this.assertCanEditCharges(req.user);
    return this.billing.updatePriceCatalogItem(+id, dto);
  }

  @Delete('billing/price-catalog/:id')
  @Roles('admin', 'billing', 'physician', 'front_desk')
  deletePriceCatalogItem(@Param('id') id: string, @Req() req: any) {
    this.assertCanEditCharges(req.user);
    return this.billing.deletePriceCatalogItem(+id);
  }

  /**
   * Only the administrator (supervisor) or a user explicitly granted the
   * special "edit charges" privilege may create/update/deactivate charges.
   * This also governs correcting an erroneous charge on a billing statement.
   */
  private assertCanEditCharges(user: any): void {
    if (!user) throw new ForbiddenException('Not authenticated');
    if (user.role === 'admin') return;
    if (user.can_edit_charges) return;
    throw new ForbiddenException(
      'Only a supervisor or a user with charge-edit permission can change charges. Contact an administrator.',
    );
  }

  // ─── Accounts Receivable + Financial Report ──────────────────────

  @Get('billing/accounts-receivable')
  @Roles('admin', 'billing', 'front_desk', 'physician', 'nurse', 'midwife', 'lab_tech', 'pharmacist', 'inventory_manager')
  getAccountsReceivable() {
    return this.billing.getAccountsReceivable();
  }

  @Get('billing/financial-report')
  @Roles('admin', 'billing', 'physician')
  getFinancialReport(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.billing.getFinancialReport(startDate, endDate);
  }

  // ─── Billing Holds (lab orders + prescriptions) ──────────────────

  @Get('billing/holds')
  @Roles('admin', 'billing', 'front_desk', 'physician', 'lab_tech', 'pharmacist')
  listHolds(@Query('status') status?: string) {
    return this.billing.listHolds(status);
  }

  @Post('billing/holds/:id/clear')
  @Roles('admin', 'billing', 'front_desk')
  async clearHold(@Param('id') id: string, @Req() req: any) {
    const by = req.user?.displayName || req.user?.username || 'billing';
    return this.billing.clearHold(+id, by);
  }

  @Post('billing/patients/:pid/holds/clear')
  @Roles('admin', 'billing', 'front_desk')
  async clearPatientHolds(@Param('pid') pid: string, @Req() req: any) {
    const by = req.user?.displayName || req.user?.username || 'billing';
    return this.billing.clearHoldsForPatient(+pid, by);
  }

  @Post('billing/orders/:type/:orderId/clear')
  @Roles('admin', 'billing', 'front_desk')
  async clearOrderHold(
    @Param('type') type: string,
    @Param('orderId') orderId: string,
    @Req() req: any,
  ) {
    const by = req.user?.displayName || req.user?.username || 'billing';
    return this.billing.clearHoldForOrder(type, +orderId, by);
  }

  // ─── Encounter-based billing breakdown (per patient) ─────────────

  @Get('patients/:pid/encounter-breakdown')
  @Roles('admin', 'billing', 'physician', 'front_desk', 'nurse')
  getEncounterBreakdown(@Param('pid') pid: string) {
    return this.billing.getPatientEncounterBreakdown(+pid);
  }

  // ─── Lab charge reconciliation ───────────────────────────────────

  /**
   * Post charges for lab orders that have no billing line (e.g. raised before
   * the per-test billing fix). Admin/billing only; idempotent, safe to re-run.
   */
  /**
   * `?dryRun=1` returns the exact plan (and what the order-id backfill would
   * link) without writing anything, so the UI can ask for confirmation.
   */
  @Post('billing/reconcile-lab-charges')
  @Roles('admin', 'billing')
  reconcileLabCharges(@Query('limit') limit?: string, @Query('dryRun') dryRun?: string) {
    return this.billing.reconcileLabCharges(
      limit ? parseInt(limit, 10) : 500,
      dryRun === '1' || dryRun === 'true',
    );
  }

  /**
   * Billing integrity scan — read-only. Detects duplicate/mis-billed lab charges,
   * rejected-order charges, superseded legacy placeholders, rounding residues,
   * credits owed, unbilled orders, price drift and orphan charges.
   */
  @Get('billing/integrity/scan')
  @Roles('admin', 'billing')
  integrityScan(@Query('pid') pid?: string) {
    return this.integrity.scan(pid ? parseInt(pid, 10) : undefined);
  }

  /**
   * Apply the safe corrections. `dryRun=1` reports what would change without
   * writing; findings needing human judgement are always left alone.
   */
  @Post('billing/integrity/fix')
  @Roles('admin', 'billing')
  integrityFix(@Body() body: { pid?: number; rules?: string[]; dryRun?: boolean }, @Req() req: any) {
    return this.integrity.applyFixes({
      pid: body?.pid,
      rules: body?.rules,
      dryRun: body?.dryRun === true,
      // Who asked for the correction — money changes must carry an operator.
      actor: req?.user?.username || req?.user?.displayName || 'unknown',
    });
  }

  /** Recent scans, newest first (scheduled + manual). */
  @Get('billing/integrity/runs')
  @Roles('admin', 'billing')
  integrityRuns(@Query('limit') limit?: string) {
    return this.integrity.getRuns(limit ? parseInt(limit, 10) : 20);
  }

  /** Scheduler settings: enabled, hour of day, and whether safe fixes auto-apply. */
  @Get('billing/integrity/settings')
  @Roles('admin', 'billing')
  integritySettings() {
    return this.integrity.getSettings();
  }

  @Put('billing/integrity/settings')
  @Roles('admin', 'billing')
  setIntegritySettings(@Body() body: { enabled?: boolean; hour?: number; autoFix?: boolean }) {
    return this.integrity.setSettings(body || {});
  }

  /** Run a scan now and record it in the history. */
  @Post('billing/integrity/run-now')
  @Roles('admin', 'billing')
  integrityRunNow(@Req() req: any) {
    return this.integrity.runScanAndRecord(
      'manual',
      req?.user?.username || req?.user?.displayName || 'unknown',
    );
  }

  /**
   * Refund an overpayment sitting on a patient's account (negative ar_activity
   * payment + ledger entry). Defaults to the whole credit; capped at it.
   */
  @Post('billing/patients/:pid/refund-credit')
  @Roles('admin', 'billing')
  refundCredit(
    @Param('pid') pid: string,
    @Body() body: { amountUSD?: number; reason?: string; receivedBy?: string },
  ) {
    return this.billing.refundPatientCredit(
      +pid,
      body?.amountUSD,
      body?.reason || 'Credit refund',
      body?.receivedBy || 'billing',
    );
  }

  /**
   * Link historical lab charges (order_id NULL) back to their lab orders so the
   * per-order de-dup can see what was already billed. Idempotent.
   */
  @Post('billing/backfill-lab-charge-orders')
  @Roles('admin', 'billing')
  backfillLabChargeOrders() {
    return this.billing.backfillLabChargeOrderIds();
  }

  // ─── Sub-threshold balances / rounding ───────────────────────────

  /**
   * Clear a few cents left over by cash collection (whole LRD notes). Only acts
   * when the residue is inside `billing_settings.small_balance_writeoff_usd`.
   */
  @Post('billing/patients/:pid/rounding-adjustment')
  @Roles('admin', 'billing')
  writeOffRounding(@Param('pid') pid: string, @Body() body: { reason?: string }) {
    return this.billing.writeOffSmallBalance(+pid, body?.reason || 'Small balance write-off');
  }
}
