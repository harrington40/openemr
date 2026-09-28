# OpenEMR New UI — Development Setup Guide

## Prerequisites

- **OpenEMR** installed and running (PHP 8.2+, MySQL/MariaDB)
- **Node.js** >= 18 (v24+ recommended)
- **npm** >= 9

## Quick Start

### 1. Register the OAuth2 Client

The SPA authenticates via OAuth2 PKCE. Register a client:

**Option A — PHP CLI (recommended):**
```bash
# From the openemr root directory
php interface/new/setup-oauth-client.php
```

**Option B — SQL:**
```bash
mysql -u root -p openemr < interface/new/setup-oauth-client.sql
```

**Option C — Admin UI:**
1. Log into OpenEMR
2. Navigate to **Admin → System → OAuth2 Clients**
3. Click "Register New Client"
4. Set:
   - Client ID: `openemr-react-client`
   - Application Type: **Public**
   - Redirect URI: `http://localhost:5173/app/callback`
   - Grant Types: `authorization_code`, `refresh_token`

### 2. Start the PHP Dev Server

```bash
# From the openemr root directory
php -S localhost:8080 -t public
```

This serves OpenEMR at `http://localhost:8080`.

### 3. Start the Vite Dev Server

```bash
cd interface/new
npm install   # already done if you ran setup
npm run dev
```

This starts the React SPA at `http://localhost:5173/app/`.

### 4. Open the App

Navigate to **[http://localhost:5173/app/](http://localhost:5173/app/)** in your browser.

Click **"Sign In with OpenEMR"** — you'll be redirected to the OpenEMR login page, then back to the SPA.

## Vite Proxy Configuration

The Vite dev server proxies API requests to the PHP backend:

| SPA URL | Proxied To |
|---------|-----------|
| `/api/*` | `http://localhost:8080/api/*` |
| `/apis/*` | `http://localhost:8080/apis/*` |
| `/oauth2/*` | `http://localhost:8080/oauth2/*` |
| `/interface/*` | `http://localhost:8080/interface/*` |

See [`vite.config.ts`](vite.config.ts) for the full proxy configuration.

## Production Build

```bash
cd interface/new
npm run build
```

Output goes to `public/dist/` with all assets using `/app/` base path.
The PHP front controller at [`public/index.php`](../../public/index.php) serves the SPA at `/app/*`.

## Architecture

```
Browser ──► Vite Dev Server (localhost:5173)
                │
                ├── /app/*         → React SPA (hot-reloaded)
                ├── /api/*         → Proxy to PHP:8080
                ├── /apis/*        → Proxy to PHP:8080
                └── /oauth2/*      → Proxy to PHP:8080

Production:
Browser ──► PHP Server (localhost:8080)
                ├── /app/*         → public/dist/index.html (React SPA)
                ├── /api/*         → REST API controllers
                ├── /interface/*   → Legacy PHP UI (unchanged)
                └── /oauth2/*      → OAuth2 endpoints
```

## Troubleshooting

### "Cannot find module" errors in VSCode
Open `interface/new/` as the root folder in VSCode, or press `Ctrl+Shift+P` → "TypeScript: Select TypeScript Version" → "Use Workspace Version".

### Login redirect loop
Ensure the OAuth2 client is registered with the correct redirect URI matching your dev server URL.

### 401 Unauthorized on API calls
The SPA uses Bearer token auth. Make sure you've completed the OAuth2 login flow. Check that the token scope includes the resources you're accessing (e.g., `api:oemr`, `api:patient`, `api:fhir`).

### CORS errors
The Vite proxy handles CORS in development. In production, configure your web server to set CORS headers or use the OpenEMR CORS configuration.
