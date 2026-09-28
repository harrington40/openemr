#!/usr/bin/env bash
#
# OpenRx deploy (LOCAL MACHINE)
# Builds the backend + React SPA, tars their dist/ folders, uploads the
# tarballs to the server, then runs the server-side deploy.sh which performs
# the swap, restarts pm2, and prunes old artifacts.
#
# Usage:
#   ./deploy-local.sh                 # build + deploy backend AND frontend
#   ./deploy-local.sh --backend       # backend only
#   ./deploy-local.sh --frontend      # frontend only
#   ./deploy-local.sh --skip-build    # upload existing dist/ folders (no build)
#   ./deploy-local.sh --keep 5        # keep 5 old backups on the server
#   ./deploy-local.sh --dry-run       # show remote actions, change nothing
#
# Env overrides: OPENRX_SERVER, OPENRX_REMOTE_DIR, KEEP
#
set -euo pipefail

SERVER="${OPENRX_SERVER:-dev@94.250.201.58}"
REMOTE_DIR="${OPENRX_REMOTE_DIR:-/home/dev/openrx}"
REMOTE_INCOMING="$REMOTE_DIR/incoming"
KEEP="${KEEP:-3}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"          # openemr repo root
BACKEND_DIR="$ROOT/backend"                   # -> dist/
FRONTEND_APP="$ROOT/interface/new"            # vite project
FRONTEND_OUT="$ROOT/public"                   # -> dist/ (vite outDir ../../public/dist)
STAGE="$SCRIPT_DIR/.build"
TS="$(date +%Y%m%d-%H%M%S)"

DO_BACKEND=1
DO_FRONTEND=1
SKIP_BUILD=0
UPLOAD_ONLY=0
DRY_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend)     DO_FRONTEND=0; shift ;;
    --frontend)    DO_BACKEND=0;  shift ;;
    --skip-build)  SKIP_BUILD=1;  shift ;;
    --upload-only) UPLOAD_ONLY=1; shift ;;
    --keep)        KEEP="${2:?--keep needs a number}"; shift 2 ;;
    --dry-run)     DRY_ARGS+=(--dry-run); shift ;;
    -h|--help)    sed -n '3,18p' "$0" | sed -E 's/^# ?//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

log()  { printf '\033[0;36m[deploy-local]\033[0m %s\n' "$*"; }
ok()   { printf '\033[0;32m           ok\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m           !!\033[0m %s\n' "$*"; }
die()  { printf '\033[0;31m       [fail]\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$KEEP" =~ ^[0-9]+$ ]] || die "--keep expects a number"

# ---- 1. build ---------------------------------------------------------------
if (( SKIP_BUILD == 0 )); then
  if (( DO_BACKEND == 1 )); then
    log "building backend (nest build)"
    ( cd "$BACKEND_DIR" && npm run build ) || die "backend build failed"
    [[ -f "$BACKEND_DIR/dist/main.js" ]] || die "backend build produced no dist/main.js"
    ok "backend dist ready"
  fi
  if (( DO_FRONTEND == 1 )); then
    log "building frontend (tsc -b && vite build)"
    # Strict: the SPA is type-checked, so a type error stops the deploy rather
    # than shipping an unverified bundle.
    ( cd "$FRONTEND_APP" && npm run build ) || die "frontend build failed (run: cd $FRONTEND_APP && npm run build)"
    [[ -f "$FRONTEND_OUT/dist/index.html" ]] || die "frontend build produced no public/dist/index.html"
    ok "frontend dist ready"
  fi
else
  log "skipping build (--skip-build)"
fi

# ---- 2. tar -----------------------------------------------------------------
mkdir -p "$STAGE"
rm -f "$STAGE"/*.tar.gz
UPLOADS=()

if (( DO_BACKEND == 1 )); then
  [[ -f "$BACKEND_DIR/dist/main.js" ]] || die "missing $BACKEND_DIR/dist/main.js"
  log "packaging backend dist"
  tar -czf "$STAGE/openrx-backend-dist.tar.gz" -C "$BACKEND_DIR" dist
  UPLOADS+=("$STAGE/openrx-backend-dist.tar.gz")
  ok "openrx-backend-dist.tar.gz"
fi

if (( DO_FRONTEND == 1 )); then
  [[ -f "$FRONTEND_OUT/dist/index.html" ]] || die "missing $FRONTEND_OUT/dist/index.html"
  log "packaging frontend dist"
  tar -czf "$STAGE/openrx-frontend-dist.tar.gz" -C "$FRONTEND_OUT" dist
  UPLOADS+=("$STAGE/openrx-frontend-dist.tar.gz")
  ok "openrx-frontend-dist.tar.gz"
fi

# ---- 3. upload --------------------------------------------------------------
log "uploading to $SERVER:$REMOTE_INCOMING"
ssh "$SERVER" "mkdir -p '$REMOTE_INCOMING'"
scp -q "${UPLOADS[@]}" "$SERVER:$REMOTE_INCOMING/"
ok "uploaded ${#UPLOADS[@]} tarball(s)"

# ---- 4. remote deploy -------------------------------------------------------
if (( UPLOAD_ONLY == 1 )); then
  log "upload-only requested — skipping remote deploy"
  log "run it later with:  ssh $SERVER 'cd $REMOTE_DIR && ./deploy.sh ...'"
else
  REMOTE_ARGS=()
  (( DO_BACKEND == 1 ))  && REMOTE_ARGS+=(--backend  "$REMOTE_INCOMING/openrx-backend-dist.tar.gz")
  (( DO_FRONTEND == 1 )) && REMOTE_ARGS+=(--frontend "$REMOTE_INCOMING/openrx-frontend-dist.tar.gz")
  REMOTE_ARGS+=(--keep "$KEEP")

  log "running remote deploy.sh"
  ssh "$SERVER" "cd '$REMOTE_DIR' && ./deploy.sh ${REMOTE_ARGS[*]} ${DRY_ARGS[*]:-}"
fi

# ---- 5. tidy local stage ----------------------------------------------------
rm -rf "$STAGE"
log "done ($TS)."
