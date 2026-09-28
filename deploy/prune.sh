#!/usr/bin/env bash
#
# OpenRx prune (SERVER SIDE)
# Deletes old deploy artifacts so the disk never fills up.
# Keeps the newest N items of each group (default 3).
#
# Usage:
#   ./prune.sh                 # keep newest 3 of every group
#   ./prune.sh --keep 5        # keep newest 5
#   ./prune.sh --all           # delete everything prunable
#   ./prune.sh --dry-run       # report only, delete nothing
#   ./prune.sh -h
#
# Env override: OPENRX_APP_DIR
#
set -euo pipefail
shopt -s nullglob

APP_DIR="${OPENRX_APP_DIR:-/home/dev/openrx}"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/public"
BACKUPS_DIR="$APP_DIR/backups"
RELEASES_DIR="$APP_DIR/releases"
INCOMING_DIR="$APP_DIR/incoming"

KEEP="${KEEP:-3}"
DRY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep)    KEEP="${2:?--keep needs a number}"; shift 2 ;;
    --all)     KEEP=0; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '3,12p' "$0" | sed -E 's/^# ?//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done
[[ "$KEEP" =~ ^[0-9]+$ ]] || { echo "--keep expects a number" >&2; exit 1; }

freed_kb=0

prune_glob() {                        # $1=label  $2=glob  [$3=keep override]
  local label="$1" glob="$2" limit="${3:-$KEEP}" p
  local -a paths=()
  for p in $glob; do [[ -e "$p" ]] && paths+=("$p"); done
  local n=${#paths[@]}
  if (( n == 0 )); then printf '  %-30s none\n' "$label"; return; fi

  mapfile -t paths < <(ls -1dt "${paths[@]}")   # newest first
  local del=$(( n - limit )); (( del < 0 )) && del=0
  printf '  %-30s %d found → delete %d, keep %d\n' "$label" "$n" "$del" "$(( n - del ))"

  local i sz
  for (( i=limit; i<n; i++ )); do
    sz=$(du -sk "${paths[$i]}" 2>/dev/null | cut -f1 || echo 0)
    freed_kb=$(( freed_kb + ${sz:-0} ))
    if (( DRY )); then
      echo "      would remove: ${paths[$i]}"
    else
      rm -rf -- "${paths[$i]}"
      echo "      removed: ${paths[$i]}"
    fi
  done
}

printf 'OpenRx prune — keep=%d dry-run=%d  (%s)\n' "$KEEP" "$DRY" "$APP_DIR"
prune_glob "backend  legacy dist.bak*"   "$BACKEND_DIR/dist.bak*"
prune_glob "frontend legacy dist.bak*"   "$FRONTEND_DIR/dist.bak*"
prune_glob "backend  backups (dist-*)"   "$BACKUPS_DIR/backend/dist-*"
prune_glob "frontend backups (dist-*)"   "$BACKUPS_DIR/frontend/dist-*"
prune_glob "release tarballs"            "$RELEASES_DIR/*.tar.gz"
prune_glob "legacy root tarballs"        "$APP_DIR/*.tar.gz"
prune_glob "incoming uploads"            "$INCOMING_DIR/*.tar.gz"
prune_glob "staging leftovers"           "$APP_DIR/.staging-*" 0

if (( DRY )); then
  printf 'Would free approximately %s MB.\n' "$(( freed_kb / 1024 ))"
else
  printf 'Freed approximately %s MB.\n' "$(( freed_kb / 1024 ))"
fi
