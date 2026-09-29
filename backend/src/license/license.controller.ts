import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { LicenseService } from './license.service';
import type { LicenseTier } from './license.entity';

@Controller('license')
export class LicenseController {
    constructor(private readonly licenseService: LicenseService) {}

    /**
     * Verify the generator passphrase server-side.
     * No secrets exposed in client code.
     */
    @Post('verify-passphrase')
    verifyPassphrase(@Body('passphrase') passphrase: string) {
        const valid = this.licenseService.verifyGeneratorPassphrase(passphrase);
        return { valid };
    }

    /**
     * Activate a license key. Public endpoint (no auth required
     * because user hasn't activated yet).
     */
    @Post('activate')
    async activate(
        @Body('key') key: string,
        @Body('customerName') customerName?: string,
    ) {
        const license = await this.licenseService.activateKey(
            key,
            customerName,
        );
        return {
            message: 'License activated successfully',
            tier: license.tier,
            expiresAt: license.expiresAt,
            maxUsers: license.maxUsers,
        };
    }

    /**
     * Check license status. Public — app checks this on startup.
     */
    @Get('status')
    async status() {
        return this.licenseService.getStatus();
    }

    /**
     * Generate license keys (admin only).
     */
    @Post('generate')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('admin')
    generate(
        @Body('tier') tier: LicenseTier,
        @Body('durationMonths') durationMonths: number,
        @Body('count') count: number = 1,
    ) {
        const keys = this.licenseService.generateBatch(
            tier,
            durationMonths || 1,
            count || 1,
        );
        return { keys };
    }

    /**
     * Revoke a license (admin only).
     */
    @Post('revoke')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('admin')
    async revoke(@Body('key') key: string) {
        await this.licenseService.revoke(key);
        return { message: 'License revoked' };
    }
}
