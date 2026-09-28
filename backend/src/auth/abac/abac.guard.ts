import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ABAC_KEY, AbacMetadata, ResourceType, ActionType } from './abac.decorator';
import { PatientAccessPolicy } from './policies/patient-access.policy.js';

/**
 * ABAC (Attribute-Based Access Control) Guard.
 *
 * Runs AFTER JwtAuthGuard and RolesGuard. Evaluates context-aware
 * policies based on the resource, action, user identity, and
 * resource ownership/relationship.
 *
 * Policy resolution:
 *   - 'patient'     → PatientAccessPolicy
 *   - 'encounter'   → (coming in Sprint 3)
 *   - 'document'    → (coming in Sprint 3)
 *   - 'appointment' → (coming in Sprint 3)
 *   - 'imaging'     → (coming in Sprint 3)
 *   - 'lab'         → (coming in Sprint 3)
 *   - 'prescription'→ (coming in Sprint 3)
 */
@Injectable()
export class AbacGuard implements CanActivate {
  private readonly logger = new Logger(AbacGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly patientPolicy: PatientAccessPolicy,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.getAllAndOverride<AbacMetadata>(ABAC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @RequireAccess() → no ABAC check needed (already handled by RolesGuard)
    if (!metadata) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const { user } = request;

    if (!user) {
      this.logger.warn('AbacGuard: No user in request');
      return false;
    }

    // Admin bypasses all ABAC checks
    if (user.role === 'admin') {
      return true;
    }

    // Extract resource ID from route params
    const resourceId = this.extractResourceId(request, metadata.resource);

    return await this.evaluatePolicy(user, metadata.resource, metadata.action, resourceId, request);
  }

  private async evaluatePolicy(
    user: any,
    resource: ResourceType,
    action: ActionType,
    resourceId: number | null,
    request: any,
  ): Promise<boolean> {
    switch (resource) {
      case 'patient':
        return this.patientPolicy.canAccess(user, action, resourceId);

      // Future policies will be added here

      default:
        this.logger.warn(`No ABAC policy for resource: ${resource}`);
        return true; // Default allow if no policy (RolesGuard already checked)
    }
  }

  private extractResourceId(request: any, resource: ResourceType): number | null {
    const params = request.params;

    switch (resource) {
      case 'patient':
        return params.id ? parseInt(params.id, 10) : params.pid ? parseInt(params.pid, 10) : null;
      case 'encounter':
        return params.eid ? parseInt(params.eid, 10) : null;
      case 'document':
      case 'imaging':
        return params.id ? parseInt(params.id, 10) : null;
      case 'appointment':
        return params.eid ? parseInt(params.eid, 10) : null;
      default:
        return params.id ? parseInt(params.id, 10) : null;
    }
  }
}
