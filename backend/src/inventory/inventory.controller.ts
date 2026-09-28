import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { InventoryService, InventoryUser } from './inventory.service';

/**
 * Inventory controller.
 *
 * Read access: clinical/operational staff who need to see stock levels, plus
 * the dedicated inventory manager.
 * Mutations:
 *   - create / edit items   → admin, inventory_manager
 *   - receive               → admin, inventory_manager, lab_tech
 *   - issue / return        → admin, inventory_manager, physician, nurse, lab_tech
 *   - transfer              → admin, inventory_manager, lab_tech
 *   - adjust (correction)   → admin, inventory_manager (requires reason)
 *   - vendors / POs         → admin, inventory_manager
 *
 * Every quantity change is recorded as an audited inventory transaction and
 * applied atomically inside a database transaction.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'inventory_manager', 'physician', 'nurse', 'lab_tech', 'front_desk')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  private toUser(req: any): InventoryUser {
    return {
      id: req?.user?.sub ?? req?.user?.id ?? null,
      displayName: req?.user?.displayName || req?.user?.username || null,
    };
  }

  @Get('inventory/dashboard')
  dashboard() {
    return this.inventory.dashboard();
  }

  @Get('inventory/low-stock')
  lowStock(@Query('limit') limit?: string) {
    return this.inventory.lowStock(Number(limit) || 5);
  }

  @Get('inventory/expiring')
  expiring() {
    return this.inventory.expiring();
  }

  @Get('inventory/categories')
  categories() {
    return this.inventory.getCategories();
  }

  @Get('inventory/departments')
  departments() {
    return this.inventory.getDepartments();
  }

  @Get('inventory')
  list(
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('department') department?: string,
    @Query('stockStatus') stockStatus?: string,
    @Query('expiration') expiration?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.inventory.list({
      search,
      category,
      department,
      stockStatus,
      expiration,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    });
  }

  @Post('inventory')
  @Roles('admin', 'inventory_manager')
  create(@Body() dto: any, @Req() req: any) {
    return this.inventory.create(dto, this.toUser(req));
  }

  @Put('inventory/:id')
  @Roles('admin', 'inventory_manager')
  update(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.inventory.update(+id, dto, this.toUser(req));
  }

  @Post('inventory/import-prices')
  @Roles('admin', 'inventory_manager')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  importPrices(
    @UploadedFile() file: any,
    @Body('sourceCurrency') sourceCurrency?: string,
    @Req() req?: any,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.inventory.importPriceList(file, this.toUser(req), sourceCurrency);
  }

  @Get('inventory/lookup-barcode/:code')
  lookupBarcode(@Param('code') code: string) {
    return this.inventory.lookupBarcode(code);
  }

  @Get('inventory/:id/transactions')
  transactions(@Param('id') id: string) {
    return this.inventory.getTransactions(+id);
  }

  @Post('inventory/:id/receive')
  @Roles('admin', 'inventory_manager', 'lab_tech')
  receive(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.inventory.receive(+id, dto, this.toUser(req));
  }

  @Post('inventory/:id/issue')
  @Roles('admin', 'inventory_manager', 'physician', 'nurse', 'lab_tech')
  issue(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.inventory.issue(+id, dto, this.toUser(req));
  }

  @Post('inventory/:id/transfer')
  @Roles('admin', 'inventory_manager', 'lab_tech')
  transfer(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.inventory.transfer(+id, dto, this.toUser(req));
  }

  @Post('inventory/:id/return')
  @Roles('admin', 'inventory_manager', 'physician', 'nurse', 'lab_tech')
  returnStock(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.inventory.returnStock(+id, dto, this.toUser(req));
  }

  @Post('inventory/:id/adjust')
  @Roles('admin', 'inventory_manager')
  adjust(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.inventory.adjust(+id, dto, this.toUser(req));
  }

  // Pharmacy / patient-use dispensing — auto-decrements the matching item.
  @Post('inventory/dispense')
  @Roles('admin', 'inventory_manager', 'physician', 'nurse', 'pharmacist')
  dispense(@Body() dto: any, @Req() req: any) {
    return this.inventory.dispense(dto, this.toUser(req));
  }

  // ── Vendors ─────────────────────────────────────────────────────────────

  @Get('inventory/vendors')
  vendors() {
    return this.inventory.listVendors();
  }

  @Post('inventory/vendors')
  @Roles('admin', 'inventory_manager')
  createVendor(@Body() dto: any) {
    return this.inventory.createVendor(dto);
  }

  @Put('inventory/vendors/:id')
  @Roles('admin', 'inventory_manager')
  updateVendor(@Param('id') id: string, @Body() dto: any) {
    return this.inventory.updateVendor(+id, dto);
  }

  // ── Purchase orders ─────────────────────────────────────────────────────

  @Get('inventory/purchase-orders')
  purchaseOrders() {
    return this.inventory.listPurchaseOrders();
  }

  @Post('inventory/purchase-orders')
  @Roles('admin', 'inventory_manager')
  createPurchaseOrder(@Body() dto: any, @Req() req: any) {
    return this.inventory.createPurchaseOrder(dto, this.toUser(req));
  }

  @Get('inventory/purchase-orders/:id')
  purchaseOrder(@Param('id') id: string) {
    return this.inventory.getPurchaseOrder(+id);
  }

  @Put('inventory/purchase-orders/:id/status')
  @Roles('admin', 'inventory_manager')
  updatePurchaseOrderStatus(@Param('id') id: string, @Body() dto: any) {
    return this.inventory.updatePurchaseOrderStatus(+id, dto?.status);
  }

  @Post('inventory/purchase-orders/:id/receive')
  @Roles('admin', 'inventory_manager')
  receivePurchaseOrder(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.inventory.receivePurchaseOrder(+id, this.toUser(req), dto);
  }

  // ── Inventory requests (department → approval → procurement) ─────────────

  @Get('inventory/requests')
  requests() {
    return this.inventory.listRequests();
  }

  @Post('inventory/requests')
  @Roles('admin', 'inventory_manager', 'nurse')
  createRequest(@Body() dto: any, @Req() req: any) {
    return this.inventory.createRequest(dto, this.toUser(req));
  }

  @Get('inventory/requests/:id')
  request(@Param('id') id: string) {
    return this.inventory.getRequest(+id);
  }

  @Put('inventory/requests/:id/status')
  @Roles('admin', 'inventory_manager', 'nurse')
  updateRequestStatus(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.inventory.updateRequestStatus(+id, dto?.status, this.toUser(req));
  }

  @Post('inventory/requests/:id/order')
  @Roles('admin', 'inventory_manager')
  orderRequest(@Param('id') id: string, @Req() req: any) {
    return this.inventory.orderRequest(+id, this.toUser(req));
  }

  // ── Reorder / forecast / accounting ─────────────────────────────────────

  @Get('inventory/reorder-suggestions')
  reorderSuggestions() {
    return this.inventory.getReorderSuggestions();
  }

  @Get('inventory/forecast')
  forecast(@Query('days') days?: string) {
    return this.inventory.getForecast(Number(days) || 90);
  }

  @Get('inventory/accounting/summary')
  accountingSummary() {
    return this.inventory.getAccountingSummary();
  }

  @Get('inventory/:id')
  getOne(@Param('id') id: string) {
    return this.inventory.getById(+id);
  }
}
