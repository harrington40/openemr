#!/usr/bin/env bash
#
# OpenRx Control Center  (LOCAL MACHINE)
# Interactive menu to build, deploy, monitor and roll back OpenRx on the
# remote server. Everything is driven over SSH.
#
# Run:    ./openrx.sh
# Batch:  printf '6\n0\n' | ./openrx.sh          # status, then exit
#
# Env overrides: OPENRX_SERVER, OPENRX_REMOTE_DIR, OPENRX_SITE, KEEP
#
set -euo pipefail

SERVER="${OPENRX_SERVER:-dev@94.250.201.58}"
REMOTE_DIR="${OPENRX_REMOTE_DIR:-/home/dev/openrx}"
SITE="${OPENRX_SITE:-https://openrx.transtechologies.com}"
KEEP="${KEEP:-3}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_LOCAL="$SCRIPT_DIR/deploy-local.sh"

B=$'\033[1;36m'; G=$'\033[0;32m'; Y=$'\033[0;33m'; R=$'\033[0;31m'; D=$'\033[2m'; N=$'\033[0m'

sha()  { ssh -o ConnectTimeout=15 "$SERVER" "$@"; }
line() { printf '%s\n' "──────────────────────────────────────────────────────────────"; }
http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1" 2>/dev/null || echo "ERR"; }
pause() { read -rp "  ${D}Enter to continue…${N}" _ || true; }

banner() {
  printf '%s' "$B"
  cat <<'EOF'
  ┌──────────────────────────────────────────────────────────┐
  │                 OpenRx   CONTROL CENTER                  │
  └──────────────────────────────────────────────────────────┘
EOF
  printf '%s' "$N"
  printf '   site   : %s\n' "$SITE"
  printf '   server : %s\n' "$SERVER"
  line
}

menu() {
  cat <<EOF
  ${B}DEPLOY${N}
   1) Build & deploy     ${D}(backend + frontend)${N}
   2) Build & deploy     ${D}(backend only)${N}
   3) Build & deploy     ${D}(frontend only)${N}
   4) Deploy pre-built   ${D}(skip build)${N}
   5) Upload tarballs    ${D}(no deploy)${N}
  ${B}OPERATE${N}
   6) Status             ${D}(pm2 · disk · site)${N}
   7) Logs               ${D}(backend)${N}
   8) Restart backend    ${D}(pm2)${N}
  ${B}RECOVER${N}
   9) List backups
  10) Rollback           ${D}(restore a backup)${N}
  11) Prune artifacts    ${D}(clean disk)${N}
  ${B}MISC${N}
  12) SSH shell
  13) Help
   0) Exit
EOF
}

do_status() {
  echo "  ${B}PM2${N}"
  sha "pm2 describe openrx-backend 2>/dev/null | grep -iE 'status|restarts|uptime|script path|exec cwd'" || true
  echo
  echo "  ${B}Disk${N}"
  sha "df -h / | tail -1" || true
  sha "du -sh $REMOTE_DIR $REMOTE_DIR/backend/dist $REMOTE_DIR/public/dist $REMOTE_DIR/backups $REMOTE_DIR/releases 2>/dev/null" || true
  echo
  echo "  ${B}Site${N}"
  printf '    frontend    HTTP %s\n' "$(http_code "$SITE/")"
  printf '    api/config  HTTP %s\n' "$(http_code "$SITE/api/config")"
  echo
  echo "  ${B}Recent backend errors${N}"
  sha "tail -n 3 ~/.pm2/logs/openrx-backend-error.log 2>/dev/null | cut -c1-110" || true
}

do_logs() {
  cat <<EOF
   1) errors  (last 60)
   2) output  (last 60)
   3) follow errors  ${D}(Ctrl-C to stop)${N}
   0) back
EOF
  local c; read -rp "  Choice › " c || return 0
  case "$c" in
    1) sha "tail -n 60 ~/.pm2/logs/openrx-backend-error.log" || true ;;
    2) sha "tail -n 60 ~/.pm2/logs/openrx-backend-out.log" || true ;;
    3) ssh -t "$SERVER" "tail -f ~/.pm2/logs/openrx-backend-error.log" || true ;;
    *) : ;;
  esac
}

do_restart() {
  echo "  Restarting openrx-backend…"
  if sha "pm2 restart openrx-backend --update-env && pm2 save"; then
    sleep 2
    sha "pm2 describe openrx-backend 2>/dev/null | grep -iE 'status|uptime'" || true
  else
    echo "  ${R}restart failed${N}"
  fi
}

do_rollback() {
  echo "  ${B}Available backups${N}"
  sha "$REMOTE_DIR/rollback.sh --list" || true
  echo
  local kind idx
  read -rp "  Restore which kind [backend/frontend] (blank=cancel) › " kind || return 0
  [[ "$kind" == "backend" || "$kind" == "frontend" ]] || { echo "  cancelled."; return 0; }
  read -rp "  Backup number (#) or 'last' › " idx || return 0
  [[ -n "$idx" ]] || { echo "  cancelled."; return 0; }
  echo
  sha "$REMOTE_DIR/rollback.sh --$kind $idx --yes" || echo "  ${R}rollback failed${N}"
}

do_prune() {
  local keep a
  read -rp "  Keep how many of each artifact? [${KEEP}] › " keep || return 0
  [[ -n "$keep" ]] || keep="$KEEP"
  echo "  ${D}(preview)${N}"
  sha "$REMOTE_DIR/prune.sh --keep $keep --dry-run" || true
  echo
  read -rp "  Delete the above? [y/N] › " a || return 0
  if [[ "$a" =~ ^[Yy]$ ]]; then
    sha "$REMOTE_DIR/prune.sh --keep $keep" || echo "  ${R}prune failed${N}"
  else
    echo "  cancelled."
  fi
}

do_help() {
  cat <<EOF
  ${B}OpenRx Control Center${N}

  Deploys are built locally, tarred, uploaded to
  $SERVER:$REMOTE_DIR/incoming, then swapped in by the
  server-side deploy.sh (which backs up the current dist and prunes).

  Retention: the newest ${B}${KEEP}${N} items of each group are kept:
    backend backups, frontend backups, releases, uploads.

  Rollback always re-archives the current dist first, so a rollback is
  itself reversible.

  CLI equivalents (run from $SCRIPT_DIR):
    ./deploy-local.sh --backend            build + ship backend
    ./deploy-local.sh --skip-build         ship existing dist/
    ./deploy-local.sh --upload-only        upload only
    ssh $SERVER '$REMOTE_DIR/rollback.sh --list'
    ssh $SERVER '$REMOTE_DIR/prune.sh --keep 3 --dry-run'
EOF
}

if [[ ! -x "$DEPLOY_LOCAL" ]]; then
  echo "  ${Y}warning:${N} $DEPLOY_LOCAL not found/executable — deploy options will fail." >&2
fi

while true; do
  banner
  menu
  read -rp "  Select › " choice || { echo; echo "  Bye."; break; }
  echo
  case "$choice" in
    1) "$DEPLOY_LOCAL"                            || echo "  ${R}deploy failed${N}" ;;
    2) "$DEPLOY_LOCAL" --backend                  || echo "  ${R}deploy failed${N}" ;;
    3) "$DEPLOY_LOCAL" --frontend                 || echo "  ${R}deploy failed${N}" ;;
    4) "$DEPLOY_LOCAL" --skip-build               || echo "  ${R}deploy failed${N}" ;;
    5) "$DEPLOY_LOCAL" --skip-build --upload-only || echo "  ${R}upload failed${N}" ;;
    6) do_status ;;
    7) do_logs ;;
    8) do_restart ;;
    9) sha "$REMOTE_DIR/rollback.sh --list" || true ;;
   10) do_rollback ;;
   11) do_prune ;;
   12) echo "  ${D}Opening shell on $SERVER (type 'exit' to return)…${N}"; ssh -t "$SERVER" || true ;;
   13) do_help ;;
    0|q|Q) echo "  Bye."; break ;;
    *) echo "  ${Y}Unknown choice:${N} $choice" ;;
  esac
  echo
  pause
done
