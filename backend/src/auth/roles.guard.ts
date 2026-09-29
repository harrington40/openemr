import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

/** Authenticated principal attached by `JwtAuthGuard`. */
interface RolesUser {
    sub?: number | string;
    role?: string;
}

/** Authenticated request as seen by the roles guard. */
interface RolesRequest {
    user?: RolesUser;
}

/**
 * Roles guard — checks if the authenticated user has the required role(s).
 *
 * Must run AFTER JwtAuthGuard (which sets req.user).
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles('admin')
 *
 * Hierarchy:
 *   admin     → can do everything (always granted)
 *   physician → clinical + patients + scheduling
 *   nurse / registered_nurse → clinical + patient registration + vitals (NEWS2, BMI, BP classification)
 *   midwife   → maternal care + delivery tracking + newborn assessments
 *   lab_tech  → lab orders + results management + specimen tracking
 *   front_desk → patients + scheduling + provider management + user registration
 *   billing   → billing only
 */
@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.getAllAndOverride<string[]>(
            ROLES_KEY,
            [context.getHandler(), context.getClass()],
        );

        // No @Roles() decorator → public or only JWT required
        if (!requiredRoles || requiredRoles.length === 0) {
            return true;
        }

        const { user } = context.switchToHttp().getRequest<RolesRequest>();
        if (!user) {
            return false;
        }

        // Admin bypasses all role checks
        if (user.role === 'admin') {
            return true;
        }

        // Check if user's role matches any required role
        return user.role !== undefined && requiredRoles.includes(user.role);
    }
}
