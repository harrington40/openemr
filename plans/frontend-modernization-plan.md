# OpenEMR Frontend Modernization Plan

## React/Vite SPA — Module-by-Module Replacement

---

## 1. Architecture Overview

### Current State

```
Browser ── HTTP ──► PHP-FPM
                    ├── public/index.php (Front Controller)
                    │   └── FallbackRouter ──► interface/*.php (Legacy PHP UI)
                    │
                    └── apis/dispatch.php (REST API)
                        └── RestControllers/* ──► Services/* ──► Database
```

### Target State (Incremental)

```
Browser ── HTTP ──► PHP-FPM
                    ├── public/index.php (Front Controller)
                    │   ├── PrimaryRouter (NEW)
                    │   │   └── React SPA / Vite Dev Server
                    │   └── FallbackRouter ──► interface/*.php (Legacy, unchanged)
                    │
                    └── apis/dispatch.php (REST API) ◄── React SPA calls
                        └── RestControllers/* ──► Services/* ──► Database
```

---

## 2. Phased Rollout Plan

### Phase 0: Foundation (Setup Project Skeleton)

| # | Task | Details | Dependencies |
|---|------|---------|-------------|
| 0.1 | Create new Vite + React project in `/interface/new/` | `npm create vite@latest` with React + TypeScript template | Node >= 24 |
| 0.2 | Set up Tailwind CSS or Bootstrap 5 | Replace/coexist with existing Bootstrap 4.6 | 0.1 |
| 0.3 | Configure proxy in `vite.config.ts` | Proxy `/api/*`, `/apis/*`, `/oauth2/*` to PHP dev server | 0.1 |
| 0.4 | Set up React Router | Hash router (to coexist with legacy PHP URLs) | 0.1 |
| 0.5 | Create API client module | Axios or fetch wrapper with base URL, auth token handling | 0.1 |
| 0.6 | Implement OAuth2 PKCE auth flow | Use `@axa-fr/react-oidc` or custom PKCE against existing OAuth2 server | 0.5 |
| 0.7 | Add `public/index.php` primary router | Route new SPA paths to serve the React `index.html`; fallback to legacy for everything else | 0.1 |
| 0.8 | Set up build pipeline | `vite build` outputs to `public/dist/` | 0.1 |
| 0.9 | Set up ESLint, Prettier, testing | Jest/Vitest for component testing | 0.1 |

### Phase 1: Authentication & Main Shell

| # | Task | Details |
|---|------|---------|
| 1.1 | Build React login page | Replace `interface/login/login.php` — call existing OAuth2 `/token` endpoint |
| 1.2 | Build MFA/2FA flow | Reuse existing TOTP/U2F backend |
| 1.3 | Build main application shell | Sidebar navigation, top bar, patient context switcher |
| 1.4 | Build patient search/finder | Replace `interface/main/finder/` — use `/api/patient` endpoint |
| 1.5 | Implement role-based navigation menu | Data from existing menu services |

### Phase 2: Patient Demographics Module

| # | Task | Details | API Endpoints |
|---|------|---------|---------------|
| 2.1 | Patient summary dashboard | Replace `interface/patient_file/summary/demographics.php` | `GET /api/patient/:id` |
| 2.2 | Edit demographics form | Replace inline PHP editing | `POST /api/patient/:id` |
| 2.3 | Insurance info component | Replace `insurance_edit.php` | `GET/POST /api/patient/:id/insurance` |
| 2.4 | Patient photos/avatars | Replace `pic/` directory | Document upload endpoints |
| 2.5 | Patient history display | Replace `history/` | Via patient history endpoint |
| 2.6 | Allergies display | Replace allergy fragment | `GET /api/allergy` |
| 2.7 | Medications display | Replace medication fragment | `GET /api/medication` |

### Phase 3: Appointment Calendar

| # | Task | Details | API Endpoints |
|---|------|---------|---------------|
| 3.1 | Calendar view component | Replace `interface/main/calendar/` JavaScript | `GET /api/appointment` |
| 3.2 | Appointment create/edit form | | `POST/PUT /api/appointment` |
| 3.3 | Patient flow board | Replace `patient_tracker/` | `GET /api/appointment/status` |

### Phase 4: Clinical Encounters & Forms

| # | Task | Details |
|---|------|---------|
| 4.1 | Encounter list/create | Replace `interface/patient_file/encounter/` |
| 4.2 | Visit summary / SOAP note | Start with one form type (e.g., clinic_note) |
| 4.3 | Vital signs component | Replace `interface/forms/vitals/` |
| 4.4 | Problem list | Replace condition/allergy fragments |

### Phase 5: Billing & Financial

| # | Task | Details |
|---|------|---------|
| 5.1 | Patient ledger | Replace `interface/patient_file/pos_checkout*.php` |
| 5.2 | Insurance allocation | Using existing billing endpoints |
| 5.3 | Payment processing | Using existing payment gateway integration |

### Phase 6: Reports & Admin

| # | Task | Details |
|---|------|---------|
| 6.1 | Patient list report | Replace `reports/patient_list.php` |
| 6.2 | Appointments report | Replace `reports/appointments_report.php` |
| 6.3 | User management admin | Replace `usergroup/` |
| 6.4 | Practice settings | Replace `practice/` |
| 6.5 | Language management | Replace `language/` |

### Phase 7: Decommission Legacy

| # | Task | Details |
|---|------|---------|
| 7.1 | Verify all modules have been migrated | Audit `interface/` for unused files |
| 7.2 | Remove FallbackRouter | Once all routes handled by SPA or API |
| 7.3 | Clean up old npm packages | Remove AngularJS, Backbone, Knockout |
| 7.4 | Final regression testing | Full E2E test suite |

---

## 3. Technology Stack

| Layer | Technology | Justification |
|-------|-----------|---------------|
| **Framework** | React 18+ (with TypeScript) | Component model, large ecosystem, coexists well with legacy |
| **Build** | Vite 6+ | Fast HMR, easy proxy config, TypeScript native |
| **Routing** | React Router v7 (hash mode) | Hash routing avoids conflicts with PHP URL patterns |
| **CSS** | Tailwind CSS 4 OR Bootstrap 5 | Bootstrap 5 is natural upgrade from 4.6; Tailwind offers more flexibility |
| **HTTP Client** | TanStack Query (React Query) + Axios | Caching, pagination, optimistic updates for API calls |
| **Auth** | `@axa-fr/react-oidc` or custom PKCE | Existing OAuth2 server already supports PKCE |
| **Forms** | React Hook Form + Zod | Type-safe form validation |
| **Tables** | TanStack Table | Powerful data tables replacing DataTables.net |
| **Date handling** | date-fns | Already present in project (`chartjs-adapter-date-fns`) |
| **Testing** | Vitest + Testing Library | Component + integration tests |
| **E2E** | Playwright or Cypress | Full regression suite |

---

## 4. Key Architectural Decisions

### 4.1 Coexistence with Legacy

```
URL Pattern                    → Handler
/                              → React SPA (redirect to /app)
/app/*                         → React SPA (served by public/index.php)
/interface/*                   → Legacy PHP (unchanged)
/apis/*                        → REST API (unchanged)
/oauth2/*                      → OAuth2 endpoints (unchanged)
/public/*                      → Static assets (unchanged)
```

The primary router in `public/index.php` checks the URL path:
- If path starts with `/app/`, serve `public/dist/index.html`
- Otherwise, fall through to the existing `FallbackRouter`

### 4.2 Authentication Strategy

The React SPA uses **OAuth2 PKCE (Authorization Code + PKCE)**:
1. User clicks "Login" → redirected to `/oauth2/authorize`
2. After auth, receives authorization code
3. Exchange code for access + refresh token at `/oauth2/token`
4. All API calls include `Authorization: Bearer <token>` header
5. Refresh token used silently when access token expires

Legacy PHP pages continue to use session-based auth — no conflict.

### 4.3 Sharing State Between Legacy and New

During transition, legacy PHP pages open in new tabs/windows for un-migrated modules.
The React SPA holds its own state (React Query cache, Redux/Zustand if needed).
No shared state between PHP and React sessions during transition.

### 4.4 API Gap Analysis

For each module migrated, check if needed API endpoints exist in:
- [`apis/routes/_rest_routes_standard.inc.php`](/apis/routes/_rest_routes_standard.inc.php)
- [`apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php`](/apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php)
- [`apis/routes/_rest_routes_portal.inc.php`](/apis/routes/_rest_routes_portal.inc.php)

If an endpoint is missing, add it to the **existing REST controllers** (not touching core services) — this is the only backend change allowed.

---

## 5. Directory Structure for New Frontend

```
interface/new/                    # React project root
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── public/
│   └── favicon.ico
├── src/
│   ├── main.tsx                  # Entry point
│   ├── App.tsx                   # Root component + router
│   ├── api/                      # API client layer
│   │   ├── client.ts             # Axios instance with auth interceptor
│   │   ├── auth.ts               # OAuth2 PKCE flow
│   │   └── endpoints/            # Per-module API functions
│   │       ├── patients.ts
│   │       ├── appointments.ts
│   │       ├── encounters.ts
│   │       └── ...
│   ├── components/               # Shared UI components
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── TopBar.tsx
│   │   │   └── PatientContext.tsx
│   │   ├── ui/                   # Generic UI primitives
│   │   ├── forms/                # Reusable form components
│   │   └── tables/               # Data table components
│   ├── features/                 # Feature-specific modules
│   │   ├── auth/
│   │   ├── patients/
│   │   ├── appointments/
│   │   ├── encounters/
│   │   ├── billing/
│   │   └── reports/
│   ├── hooks/                    # Custom React hooks
│   ├── types/                    # TypeScript type definitions
│   └── utils/                    # Utility functions
├── vitest.config.ts
└── tests/
    ├── unit/
    └── e2e/
```

---

## 6. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Missing API endpoints for existing UI features | Audit APIs during each phase; add controller endpoints where gaps exist (backend change, but no core service changes) |
| Performance regression | React SPA typically faster than server-rendered PHP; monitor via Lighthouse |
| Auth conflicts between sessions and OAuth2 | Keep separate; legacy PHP uses sessions, SPA uses tokens |
| Migration takes too long | Focus on highest-value modules first (login, demographics); remaining legacy pages remain fully functional |
| Developer learning curve | Phase 0 includes CI, linting, component patterns documentation |

---

## 7. Success Criteria

- [ ] Login, MFA, and main navigation work as a React SPA
- [ ] Patient demographics module fully migrated and feature-complete
- [ ] Appointment calendar migrated
- [ ] All existing REST API endpoints functional and used by React
- [ ] Legacy PHP pages continue to work for non-migrated modules
- [ ] Zero changes to `src/Services/` business logic
- [ ] Build pipeline produces deployable `public/dist/` bundle
