import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ProviderService } from './provider.service';

/** Authenticated request for the provider dashboard endpoints. */
interface ProviderRequest {
    user?: { sub?: number | string };
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProviderController {
    constructor(private readonly providerService: ProviderService) {}

    /**
     * Provider's own dashboard — today's patients + stats.
     * Requires: physician or admin role.
     */
    @Get('provider/dashboard')
    @Roles('admin', 'physician')
    async getMyDashboard(@Req() req: ProviderRequest) {
        const providerId = Number(req.user?.sub);
        if (!providerId) return null;
        return this.providerService.getDashboard(providerId);
    }

    /**
     * View any provider's profile (for registration staff, admin).
     */
    @Get('provider/profile/:id')
    @Roles('admin', 'physician', 'front_desk')
    async getProfile(@Param('id') id: string) {
        return this.providerService.getProfile(+id);
    }

    /**
     * List all active providers (for dropdowns, registration).
     */
    @Get('providers')
    @Roles('admin', 'physician', 'nurse', 'front_desk')
    async getProviders() {
        return this.providerService.getProviders();
    }

    /**
     * List providers available today (In Office blocks).
     * Used for quick-assign of walk-in patients.
     */
    @Get('providers/available-today')
    @Roles('admin', 'physician', 'nurse', 'front_desk')
    async getAvailableToday() {
        return this.providerService.getAvailableToday();
    }

    /**
     * Sync status — shows when each data component was last updated.
     */
    @Get('provider/sync-status')
    @Roles('admin', 'physician')
    async getSyncStatus(@Req() req: ProviderRequest) {
        const providerId = Number(req.user?.sub);
        if (!providerId) return null;
        return this.providerService.getSyncStatus(providerId);
    }
}
