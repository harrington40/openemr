#!/usr/bin/env bash
#
# OpenRx rollback (SERVER SIDE)
# Restores a previously backed-up dist/ directory and restarts the backend.
#
# Usage:
#   ./rollback.sh --list
#   ./rollback.sh --backend  [N|last|/path]     # N-th newest (1 = newest)
#   ./rollback.sh --frontend [N|last|/path]
#   ./rollback.sh --backend 1 --dry-run
#   ./rollback.sh --backend 1 --yes             # skip confirmation
#
# Env overrides: OPENRX_APP_DIR, OPENRX_PM2_APP
#
set -euo pipefail
shopt -s nullglob

APP_DIR="${OPENRX_APP_DIR:-/home/dev/openrx}"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/public"
BACKUPS_DIR="$APP_DIR/backups"
PM2_APP="${OPENRX_PM2_APP:-openrx-backend}"
TS="$(date +%Y%m%d-%H%M%S)"

DO_LIST=0
DO_RESTART=1
ASSUME_YES=0
DRY=0
KIND=""
SEL=""

tgt_for() { case "$1" in backend) echo "$BACKEND_DIR" ;; frontend) echo "$FRONTEND_DIR" ;; *) return 1 ;; esac; }
marker_for() { case "$1" in backend) echo "main.js" ;; frontend) echo "index.html" ;; *) return 1 ;; esac; }
subdir_for() { case "$1" in backend) echo "backend" ;; frontend) echo "frontend" ;; *) return 1 ;; esac; }

list_cands() {                        # $1=kind -> candidate dirs, newest first
  local kind="$1" target sub p
  target="$(tgt_for "$kind")"; sub="$(subdir_for "$kind")"
  local -a all=()
  for p in "$target"/dist.bak*;   do [[ -d "$p" ]] && all+=("$p"); done
  for p in "$BACKUPS_DIR/$sub"/dist-*; do [[ -d "$p" ]] && all+=("$p"); done
  if ((${#all[@]})); then ls -1dt "${all[@]}"; fi
}

usage() { sed -n '3,13p' "$0" | sed -E 's/^# ?//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list)      DO_LIST=1; shift ;;
    --backend)
      KIND=backend
      if [[ -n "${2:-}" && "${2:0:2}" != "--" ]]; then SEL="$2"; shift; else SEL=last; fi
      shift ;;
    --frontend)
      KIND=frontend
      if [[ -n "${2:-}" && "${2:0:2}" != "--" ]]; then SEL="$2"; shift; else SEL=last; fi
      shift ;;
    --no-restart) DO_RESTART=0; shift ;;
    --yes|-y)    ASSUME_YES=1; shift ;;
    --dry-run)   DRY=1; shift ;;
    -h|--help)   usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ "$DO_LIST" -eq 1 ]]; then
  for kind in backend frontend; do
    echo
    echo "== $kind backups (newest first) =="
    cnt=0
    while IFS= read -r p; do
      cnt=$(( cnt + 1 ))
      printf '  %2d) %-24s  %s  %s\n' "$cnt" "$(basename "$p")" \
        "$(date -r "$p" '+%Y-%m-%d %H:%M' 2>/dev/null || echo '?')" \
        "$(du -sh "$p" 2>/dev/null | cut -f1)"
    done < <(list_cands "$kind")
    if (( cnt == 0 )); then echo "  (none)"; fi
  done
  exit 0
fi

[[ -n "$KIND" ]] || { usage; exit 1; }

target="$(tgt_for "$KIND")"; marker="$(marker_for "$KIND")"; sub="$(subdir_for "$KIND")"

# ---- resolve selection ------------------------------------------------------
src=""
if [[ "$SEL" == "last" || "$SEL" == "1" ]]; then SEL=1; fi
if [[ "$SEL" =~ ^[0-9]+$ ]]; then
  mapfile -t list < <(list_cands "$KIND")
  n=${#list[@]}
  (( n > 0 )) || { echo "no $KIND backups available" >&2; exit 1; }
  idx=$(( SEL - 1 ))
  (( idx >= 0 && idx < n )) || { echo "invalid index $SEL (have $n)" >&2; exit 1; }
  src="${list[$idx]}"
elif [[ -d "$SEL" ]]; then
  src="$SEL"
else
  echo "no such backup: $SEL" >&2; exit 1
fi

[[ -f "$src/$marker" ]] || { echo "backup missing $marker, refusing: $src" >&2; exit 1; }

echo "Rollback $KIND"
echo "    from : $src"
echo "    to   : $target/dist"
if [[ "$DRY" -eq 1 ]]; then echo "    (dry-run — nothing will change)"; fi

if [[ "$ASSUME_YES" -eq 0 && "$DRY" -eq 0 ]]; then
  read -rp "Proceed? [y/N] " a
  [[ "$a" =~ ^[Yy]$ ]] || { echo "aborted."; exit 0; }
fi

if [[ "$DRY" -eq 0 ]]; then
  mkdir -p "$BACKUPS_DIR/$sub"
  if [[ -d "$target/dist" ]]; then
    mv "$target/dist" "$BACKUPS_DIR/$sub/dist-prerollback-$TS"
    echo "    current dist saved → backups/$sub/dist-prerollback-$TS"
  fi
  mv "$src" "$target/dist"
  [[ -f "$target/dist/$marker" ]] || { echo "rollback verification failed" >&2; exit 1; }
  echo "    restored ✓"

  if [[ "$KIND" == "backend" && "$DO_RESTART" -eq 1 ]]; then
    if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
      pm2 restart "$PM2_APP" --update-env >/dev/null && pm2 save >/dev/null
      echo "    pm2: $PM2_APP restarted"
    fi
  fi
fi
echo "done."
