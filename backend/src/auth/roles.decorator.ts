import { SetMetadata } from '@nestjs/common';

/**
 * Role-based access control decorator.
 * 
 * Usage:
 *   @Roles('admin')
 *   @Roles('admin', 'physician')
 * 
 * Apply alongside @UseGuards(JwtAuthGuard).
 */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
