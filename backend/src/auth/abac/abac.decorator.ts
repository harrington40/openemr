import { SetMetadata } from '@nestjs/common';

export const ABAC_KEY = 'abac';

export type ResourceType =
  | 'patient'
  | 'encounter'
  | 'document'
  | 'prescription'
  | 'appointment'
  | 'imaging'
  | 'lab';

export type ActionType =
  | 'read'
  | 'write'
  | 'delete'
  | 'verify'
  | 'prescribe'
  | 'dispense'
  | 'upload';

export interface AbacMetadata {
  resource: ResourceType;
  action: ActionType;
}

/**
 * Attribute-Based Access Control decorator.
 *
 * Declares the resource type and action required to access an endpoint.
 * The AbacGuard evaluates context-aware policies (patient-provider
 * relationship, ownership, etc.) beyond simple role checks.
 *
 * Usage:
 *   @RequireAccess('patient', 'read')
 *   @RequireAccess('document', 'write')
 *
 * Apply alongside @UseGuards(JwtAuthGuard, RolesGuard, AbacGuard).
 */
export const RequireAccess = (resource: ResourceType, action: ActionType) =>
  SetMetadata(ABAC_KEY, { resource, action } as AbacMetadata);
