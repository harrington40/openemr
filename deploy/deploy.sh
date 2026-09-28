#!/usr/bin/env bash
#
# OpenRx deploy (SERVER SIDE)
# Deploys PRE-BUILT tarballs that were uploaded from a local machine.
# Each tarball must contain a top-level dist/ directory.
#
# Usage:
#   ./deploy.sh --backend <backend.tar.gz> [--frontend <frontend.tar.gz>] [options]
#   ./deploy.sh <file.tar.gz> [<file.tar.gz>]        # auto-detect backend/frontend
#
# Options:
#   --backend FILE   deploy backend dist  (tarball must contain main.js)
#   --frontend FILE  deploy frontend dist (tarball must contain index.html)
#   --keep N         number of backups + release tarballs to retain (default 3)
#   --no-restart     do not touch pm2
#   --recreate       delete+recreate the pm2 app from ecosystem.config.js
#   --dry-run        show what would happen, change nothing
#   -h, --help
#
# Env overrides: OPENRX_APP_DIR, OPENRX_PM2_APP, KEEP
#
set -euo pipefail
shopt -s nullglob

APP_DIR="${OPENRX_APP_DIR:-/home/dev/openrx}"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/public"
BACKUPS_DIR="$APP_DIR/backups"
RELEASES_DIR="$APP_DIR/releases"
INCOMING_DIR="$APP_DIR/incoming"
PM2_APP="${OPENRX_PM2_APP:-openrx-backend}"

KEEP="${KEEP:-3}"
DO_RESTART=1
DO_RECREATE=0
DRY=0
TS="$(date +%Y%m%d-%H%M%S)"

BACKEND_TARBALL=""
FRONTEND_TARBALL=""
AUTO_FILES=()

log()  { printf '\033[0;36m[deploy]\033[0m %s\n' "$*"; }
ok()   { printf '\033[0;32m      ok\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m      !!\033[0m %s\n' "$*"; }
die()  { printf '\033[0;31m   [fail]\033[0m %s\n' "$*" >&2; exit 1; }
run()  { if [[ "$DRY" -eq 1 ]]; then echo "      (dry-run) $*"; else "$@"; fi; }

usage() {
  sed -n '3,18p' "$0" | sed -E 's/^# ?//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend)
      [[ -n "${2:-}" && -f "${2:-}" ]] || die "--backend file not found: ${2:-<none>}"
      BACKEND_TARBALL="$2"; shift 2 ;;
    --frontend)
      [[ -n "${2:-}" && -f "${2:-}" ]] || die "--frontend file not found: ${2:-<none>}"
      FRONTEND_TARBALL="$2"; shift 2 ;;
    --keep)      KEEP="${2:?--keep needs a number}"; shift 2 ;;
    --no-restart) DO_RESTART=0; shift ;;
    --recreate)   DO_RECREATE=1; shift ;;
    --dry-run)    DRY=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    -*)           die "unknown option: $1" ;;
    *)            AUTO_FILES+=("$1"); shift ;;
  esac
done

detect_kind() {                       # $1 = tarball -> backend|frontend|unknown
  local listing
  listing="$(tar -tzf "$1" 2>/dev/null | head -400)" || die "cannot read tarball: $1"
  if   grep -qE '(^|/)main\.js$'    <<<"$listing"; then echo backend
  elif grep -qE '(^|/)index\.html$' <<<"$listing"; then echo frontend
  else echo unknown; fi
}

for f in "${AUTO_FILES[@]:-}"; do
  [[ -n "$f" ]] || continue
  [[ -f "$f" ]] || die "file not found: $f"
  case "$(detect_kind "$f")" in
    backend)  BACKEND_TARBALL="$f" ;;
    frontend) FRONTEND_TARBALL="$f" ;;
    *)        die "cannot tell if '$f' is backend or frontend — use --backend/--frontend" ;;
  esac
done

[[ -n "$BACKEND_TARBALL" || -n "$FRONTEND_TARBALL" ]] || { usage; exit 1; }
[[ "$KEEP" =~ ^[0-9]+$ ]] || die "--keep expects a number"

extract_dist() {                      # $1=tarball $2=staging -> echoes dist dir
  local tar="$1" stage="$2"
  rm -rf "$stage"; mkdir -p "$stage"
  tar -xzf "$tar" -C "$stage"
  if [[ -d "$stage/dist" ]]; then echo "$stage/dist"; else echo "$stage"; fi
}

deploy_one() {                        # $1=kind $2=tarball
  local kind="$1" tar="$2" target marker stage distdir
  case "$kind" in
    backend)  target="$BACKEND_DIR";  marker="main.js" ;;
    frontend) target="$FRONTEND_DIR"; marker="index.html" ;;
    *) die "bad kind: $kind" ;;
  esac

  log "deploying $kind from $(basename "$tar")"
  stage="$APP_DIR/.staging-${kind}-${TS}"
  distdir="$(extract_dist "$tar" "$stage")"
  [[ -f "$distdir/$marker" ]] || { run rm -rf "$stage"; die "$kind tarball missing '$marker' — refusing to deploy"; }
  ok "validated ($marker present)"

  run mkdir -p "$RELEASES_DIR"
  if [[ "$DRY" -eq 0 ]]; then
    cp -f "$tar" "$RELEASES_DIR/openrx-${kind}-dist-${TS}.tar.gz"
    ok "archived → releases/openrx-${kind}-dist-${TS}.tar.gz"
  fi

  # Stage the replacement next to its destination first, so the swap itself is a
  # single rename. Previously the old dist was moved away and only then the new
  # one moved in, leaving a window with no dist at all — any restart in that
  # window died with "Cannot find module dist/main.js" and pm2 kept retrying.
  run mv "$distdir" "$target/dist.incoming"

  run mkdir -p "$BACKUPS_DIR/$kind"
  if [[ -d "$target/dist" ]]; then
    run mv "$target/dist" "$BACKUPS_DIR/$kind/dist-${TS}"
    ok "previous $kind dist backed up → backups/$kind/dist-${TS}"
  fi

  run mv "$target/dist.incoming" "$target/dist"
  run rm -rf "$stage"
  if [[ "$DRY" -eq 0 && ! -f "$target/dist/$marker" ]]; then
    die "$kind deploy verification failed"
  fi
  ok "live: $target/dist"

  if [[ "$DRY" -eq 0 && "$tar" == "$INCOMING_DIR"/* ]]; then
    rm -f "$tar"; ok "removed upload from incoming/"
  fi
}

restart_backend() {
  [[ "$DO_RESTART" -eq 1 ]] || { warn "pm2 restart skipped (--no-restart)"; return; }
  if [[ "$DO_RECREATE" -eq 1 ]]; then
    run pm2 delete "$PM2_APP" >/dev/null 2>&1 || true
    run pm2 start "$APP_DIR/ecosystem.config.js" --only "$PM2_APP" >/dev/null
    ok "pm2: $PM2_APP recreated from ecosystem.config.js"
  elif pm2 describe "$PM2_APP" >/dev/null 2>&1; then
    # NOT --update-env: that replaces the process environment with this shell's,
    # which over SSH has no NODE_ENV, silently discarding the `env` block from
    # ecosystem.config.js. Dropping NODE_ENV is what turned per-query SQL logging
    # (including patient parameters) back on after every deploy.
    run pm2 restart "$PM2_APP" >/dev/null
    ok "pm2: $PM2_APP restarted"
  else
    run pm2 start "$APP_DIR/ecosystem.config.js" --only "$PM2_APP" >/dev/null
    ok "pm2: $PM2_APP started from ecosystem.config.js"
  fi
  run pm2 save >/dev/null
}

# ---- run -------------------------------------------------------------------
if [[ -n "$BACKEND_TARBALL" ]];  then deploy_one backend  "$BACKEND_TARBALL";  fi
if [[ -n "$FRONTEND_TARBALL" ]]; then deploy_one frontend "$FRONTEND_TARBALL"; fi
if [[ -n "$BACKEND_TARBALL" ]];  then restart_backend; fi

# ---- keep the disk clean ---------------------------------------------------
if [[ -x "$APP_DIR/prune.sh" ]]; then
  log "pruning old artifacts (keep=$KEEP)"
  prune_args=(--keep "$KEEP")
  [[ "$DRY" -eq 1 ]] && prune_args+=(--dry-run)
  KEEP="$KEEP" "$APP_DIR/prune.sh" "${prune_args[@]}" || warn "prune reported an issue"
fi

log "done."
