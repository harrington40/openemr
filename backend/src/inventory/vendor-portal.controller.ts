import {
  Controller,
  Get,
  Post,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';

/**
 * Public vendor portal.
 *
 * Vendors are given a shareable access-token URL (no login). They can view
 * their purchase orders and acknowledge them. This is intentionally separate
 * from the authenticated InventoryController so no JWT is required.
 */
@Controller()
export class VendorPortalController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('vendor/portal/:token')
  async portal(@Param('token') token: string) {
    const vendor = await this.inventory.getVendorByToken(token);
    if (!vendor) throw new NotFoundException('Vendor not found or inactive');
    const orders = await this.inventory.getVendorPurchaseOrders(vendor.id);
    return {
      vendor: {
        id: vendor.id,
        name: vendor.name,
        contact_name: vendor.contact_name,
        email: vendor.email,
        phone: vendor.phone,
      },
      orders,
    };
  }

  @Post('vendor/portal/:token/orders/:id/acknowledge')
  async acknowledge(@Param('token') token: string, @Param('id') id: string) {
    const vendor = await this.inventory.getVendorByToken(token);
    if (!vendor) throw new NotFoundException('Vendor not found or inactive');
    await this.inventory.acknowledgePurchaseOrder(+id);
    return { ok: true };
  }
}
