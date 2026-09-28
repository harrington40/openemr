import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { LicenseService } from './license.service';

/**
 * License guard — blocks all API requests if no valid license exists.
 * Public endpoints (license activation, status check, auth) are excluded.
 */
@Injectable()
export class LicenseGuard implements CanActivate {
  private readonly logger = new Logger(LicenseGuard.name);

  private readonly PUBLIC_PATHS = [
    '/api/license/activate',
    '/api/license/status',
    '/api/auth/login',
  ];

  constructor(private readonly licenseService: LicenseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const path = request.path || request.url;

    // Allow public paths
    if (this.PUBLIC_PATHS.some((p) => path.startsWith(p))) {
      return true;
    }

    // Check license
    const valid = await this.licenseService.isValid();
    if (!valid) {
      this.logger.warn(`Blocked request to ${path}: no valid license`);
      return false;
    }

    return true;
  }
}
