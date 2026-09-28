# OpenRx: Full RBAC + Content-Aware Authorization & Rebranding Plan

## Phase 1: Rebranding — OpenEMR → OpenRx

### 1.1 Frontend (React SPA)

| File | Change |
|------|--------|
| [`LoginPage.tsx`](interface/new/src/features/auth/LoginPage.tsx:42) | `"OpenEMR"` → `"OpenRx"`, subtitle: `"Electronic Prescription & Health Records"` |
| [`Sidebar.tsx`](interface/new/src/components/layout/Sidebar.tsx:130) | Brand text `"OpenEMR"` → `"OpenRx"` |
| [`index.html`](interface/new/index.html) | `<title>OpenEMR</title>` → `<title>OpenRx</title>`, favicon |
| [`AdminPage.tsx`](interface/new/src/features/admin/AdminPage.tsx) | `"OpenEMR Clinic"` → `"OpenRx Clinic"`, config labels |
| [`HelpFaqPage.tsx`](interface/new/src/features/help/HelpFaqPage.tsx) | All `"OpenEMR"` references → `"OpenRx"` |
| [`App.test.tsx`](interface/new/src/test/App.test.tsx) | Test assertions `"OpenEMR"` → `"OpenRx"` |
| Type comments in `types/*.ts` | `"OpenEMR API"` → `"OpenRx API"` |
| [`client.ts`](interface/new/src/api/client.ts:7) | Comment `"OpenEMR API"` → `"OpenRx API"` |
| [`useMessagingSocket.ts`](interface/new/src/hooks/useMessagingSocket.ts:7) | Comment `"OpenEMR WebSocket"` → `"OpenRx WebSocket"` |

### 1.2 Backend (NestJS)

| File | Change |
|------|--------|
| [`jwt.strategy.ts`](backend/src/auth/jwt.strategy.ts:25) | `'openemr-nestjs-secret-key-2024'` → `'openrx-secret-key-2024'` |
| [`auth.module.ts`](backend/src/auth/auth.module.ts:12) | Same secret key update |
| [`smart.module.ts`](backend/src/smart/smart.module.ts:6) | Same secret key update |
| [`app.module.ts`](backend/src/app.module.ts:53) | `clientId: 'openemr'` → `'openrx'` |
| [`event-bus.module.ts`](backend/src/event-bus/event-bus.module.ts) | `clientId: 'openemr'` → `'openrx'` (x3) |
| [`messaging-gateway.ts`](backend/src/messaging/messaging-gateway.ts) | Topic prefixes `openemr.*` → `openrx.*`, "Connected to OpenEMR Messaging" → "Connected to OpenRx Messaging" |
| [`message-producer.service.ts`](backend/src/messaging/message-producer.service.ts) | All topic strings `openemr.*` → `openrx.*` |
| [`message-consumer.service.ts`](backend/src/messaging/message-consumer.service.ts) | All topic subscriptions `openemr.*` → `openrx.*` |
| [`database.config.ts`](backend/src/config/database.config.ts) | Default DB name `'openemr'` → `'openrx'` (for new installs) |
| [`event-bus.interface.ts`](backend/src/event-bus/event-bus.interface.ts:6) | Comment `"openemr.messages.clinic"` → `"openrx.messages.clinic"` |
| [`main.ts`](backend/src/main.ts) | Console log branding |
| [`package.json`](backend/package.json) | `"name": "backend"` → `"name": "openrx-backend"`, description |
| [`backend/.env`](backend/.env) | Add `JWT_SECRET=openrx-secret-key-2024` and `APP_NAME=OpenRx` |

### 1.3 PHP / Docker (legacy core — minimal touch)

| File | Change |
|------|--------|
| [`docker/development-easy-light/docker-compose.yml`](docker/development-easy-light/docker-compose.yml) | Environment `MYSQL_DATABASE: openrx` (new installs), labels |
| `index.html` (root Vite) | Title and metadata |

---

## Phase 2: Full RBAC with Content-Aware Filtering

### 2.1 Role Hierarchy & Permissions Matrix

```
ADMIN ─── can do everything (bypass all checks)
  │
  ├── PHYSICIAN ─── full clinical + own patients + prescribing
  │
  ├── NURSE ─── view clinical + vitals + assist physician
  │
  ├── PHARMACIST ─── view prescriptions + verify + dispense
  │
  ├── LAB_TECH ─── lab orders + results + imaging upload
  │
  ├── RADIOLOGIST ─── DICOM/xray view + report
  │
  ├── FRONT_DESK ─── scheduling + patient reg + check-in
  │
  ├── BILLING ─── claims + transactions + insurance
  │
  └── PATIENT ─── portal: own records + appointments + messages
```

### 2.2 Content-Aware Authorization (ABAC Layer)

This is the "smart algorithm" component. Beyond simple role checks, we add context-aware rules:

#### Rule Engine Architecture

```typescript
// New: backend/src/auth/abac/
├── abac.guard.ts          // Main ABAC guard (runs after RolesGuard)
├── abac.decorator.ts      // @RequireAccess(resource, action)
├── policies/
│   ├── patient-access.policy.ts   // Can this user access this patient?
│   ├── encounter-access.policy.ts // Can this user access this encounter?
│   ├── document-access.policy.ts  // Can this user access this document?
│   └── prescription.policy.ts    // Can this user prescribe/verify?
└── abac.module.ts
```

#### Core Rules

1. **Patient Data Access**
   - Physician/Nurse can only access patients assigned to them (`patient_data.providerID`)
   - Admin can access all patients
   - Patient can only access their own record
   - Front desk can search/register but not view clinical details

2. **Encounter Access**
   - Only the creating provider + admin can view full encounter
   - Nurse can view encounters for assigned patients
   - Billing can only see billing-relevant fields (CPT codes, not clinical notes)

3. **Document Access**
   - Uploader can always see their documents + codes
   - Only verified recipients (with code) can download
   - Patient can see documents linked to their PID

4. **Prescription / eRx**
   - Only physician/pharmacist can create prescriptions
   - Pharmacist can verify and dispense
   - Patient can view their own active prescriptions

5. **Schedule / Appointments**
   - Front desk can create/modify any appointment
   - Provider can only modify their own schedule
   - Patient can book/cancel their own appointments

### 2.3 New Backend Files to Create

```typescript
// backend/src/auth/abac/abac.guard.ts
@Injectable()
export class AbacGuard implements CanActivate {
  // Reads @RequireAccess(resource, action) from handler
  // Calls the appropriate policy based on resource type
  // Returns true/false based on user + resource + action
}

// backend/src/auth/abac/abac.decorator.ts
export const ABAC_KEY = 'abac';
export const RequireAccess = (resource: ResourceType, action: ActionType) =>
  SetMetadata(ABAC_KEY, { resource, action });

type ResourceType = 'patient' | 'encounter' | 'document' | 'prescription' | 'appointment' | 'imaging';
type ActionType = 'read' | 'write' | 'delete' | 'verify' | 'prescribe' | 'dispense';
```

### 2.4 Existing Controllers to Update

Each controller gets `@RequireAccess()` decorators + `AbacGuard` added to the guard chain:

| Controller | Resources | Actions |
|-----------|-----------|---------|
| `PatientsController` | `patient` | `read`, `write` |
| `EncountersController` | `encounter` | `read`, `write` |
| `DocumentsController` | `document` | `read`, `write`, `verify` (upload already has uploaderUserId) |
| `AppointmentsController` | `appointment` | `read`, `write`, `delete` |
| `ClinicalController` | `encounter` | `read`, `write` (prescriptions, conditions, allergies) |
| `ImagingController` | `imaging` | `read`, `write`, `delete` |
| `LabsController` | `encounter` | `read`, `write` |

### 2.5 Database Changes for Content-Aware Filtering

```sql
-- Add provider-patient assignment if not present
-- (patient_data.providerID already exists in OpenEMR schema)

-- Add encounter-provider link if not present
-- (form_encounter.provider_id already exists)

-- Ensure documents_secure.uploaderUserId is populated (already done)
```

### 2.6 Frontend Role-Based UI

The Sidebar already has `roles` arrays. Update the role list:

```typescript
// Add new roles to sidebar menu sections
{ label: 'Pharmacy', icon: 'bi-capsule', roles: ['admin', 'physician', 'pharmacist'],
  children: [
    { to: '/prescriptions', label: 'Prescriptions', icon: 'bi-prescription2', roles: ['admin', 'physician', 'pharmacist'] },
  ]
},
```

---

## Phase 3: Smart Algorithm — Intelligent Access Patterns

### 3.1 Audit Logging

```typescript
// backend/src/auth/audit/
├── audit.service.ts       // Logs all access attempts
├── audit.interceptor.ts   // NestJS interceptor for auto-logging
└── audit.entity.ts        // AuditLog table
```

Every data access logs: `{ userId, resource, action, resourceId, timestamp, success, ip }`

### 3.2 Anomaly Detection (Future)

- Flag unusual access patterns (e.g., physician accessing 100+ patients in 1 hour)
- Rate limiting per role
- Geolocation/IP-based access restrictions

### 3.3 Temporary Access Grants

```typescript
// New entity: AccessGrant
// Physician can grant temporary access to a nurse for a specific patient
@Entity('access_grants')
class AccessGrant {
  id: number;
  granterId: number;      // who granted
  granteeId: number;      // who received access
  patientId: number;      // which patient
  resource: string;       // what resource type
  expiresAt: Date;        // auto-expires
  reason: string;         // audit trail
}
```

---

## Implementation Order

### Sprint 1: Rebranding (foundation)
1. Update frontend branding (8 files)
2. Update backend branding (12 files)
3. Update `.env` and config files
4. Verify all tests pass

### Sprint 2: RBAC Foundation
1. Create `AbacGuard` + `AbacDecorator`
2. Create base policy interface + `PatientAccessPolicy`
3. Integrate into `PatientsController`
4. Test with different roles

### Sprint 3: Content-Aware Policies
1. `EncounterAccessPolicy`
2. `DocumentAccessPolicy`
3. `AppointmentAccessPolicy`
4. Integrate into all controllers

### Sprint 4: Audit + Intelligence
1. `AuditService` + `AuditInterceptor`
2. `AuditLog` entity + table
3. `AccessGrant` entity + table
4. Dashboard view of audit logs

### Sprint 5: Frontend Integration
1. Update Sidebar with new role-based sections
2. Add role indicators in UI
3. Handle 403 errors gracefully with redirect
4. Patient portal access controls

---

## Files Summary

| Category | New Files | Modified Files |
|----------|-----------|----------------|
| Rebranding (Frontend) | 0 | 8 |
| Rebranding (Backend) | 0 | 12 |
| ABAC Core | 4 | 0 |
| Policies | 4 | 0 |
| Audit | 3 | 0 |
| Controller updates | 0 | 7 |
| Frontend RBAC UI | 0 | 3 |
| **Total** | **11** | **30** |
