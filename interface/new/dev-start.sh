#!/usr/bin/env bash
set -e

NEST_PORT="${1:-3002}"
VITE_PORT="${2:-5173}"
KAFKA_PORT="${3:-9092}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENEMR_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKEND_DIR="$OPENEMR_ROOT/backend"
KAFKA_HOME="/opt/kafka"
START_KAFKA="${START_KAFKA:-yes}"   # set START_KAFKA=no to skip Kafka

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║   OpenEMR — React SPA + NestJS + Kafka (Dev Mode)              ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo "  OpenEMR root:  $OPENEMR_ROOT"
echo "  Kafka:         $KAFKA_PORT  (${START_KAFKA})"
echo "  NestJS port:   $NEST_PORT"
echo "  Vite port:     $VITE_PORT  (HMR)"
echo ""

# ── Cleanup trap ────────────────────────────────────────────────
cleanup() {
    echo ""
    echo "Shutting down servers..."
    [ -n "$VITE_PID" ]  && kill $VITE_PID  2>/dev/null || true
    [ -n "$NEST_PID" ]  && kill $NEST_PID  2>/dev/null || true
    if [ -n "$KAFKA_PID" ]; then
        echo "  Stopping Kafka..."
        kill $KAFKA_PID 2>/dev/null || true
        sleep 2
    fi
    echo "Done."
    exit 0
}
trap cleanup SIGINT SIGTERM

# ── Port cleanup ────────────────────────────────────────────────
echo "[0/3] Cleaning up existing processes..."
for port in $KAFKA_PORT $NEST_PORT $VITE_PORT; do
    lsof -ti :$port 2>/dev/null | xargs -r kill 2>/dev/null || true
done
sleep 1

# ── Kafka (KRaft mode, no Zookeeper) ───────────────────────────
if [ "$START_KAFKA" = "yes" ] && [ -f "$KAFKA_HOME/bin/kafka-server-start.sh" ]; then
    echo "[1/3] Starting Kafka (KRaft, no Zookeeper)..."
    # Check if storage is formatted
    if [ ! -d /tmp/kraft-combined-logs ]; then
        CLUSTER_ID=$("$KAFKA_HOME/bin/kafka-storage.sh" random-uuid)
        "$KAFKA_HOME/bin/kafka-storage.sh" format -t "$CLUSTER_ID" -c "$KAFKA_HOME/config/kraft/server.properties" > /dev/null 2>&1
        echo "      Kafka storage formatted (cluster: $CLUSTER_ID)"
    fi
    "$KAFKA_HOME/bin/kafka-server-start.sh" -daemon "$KAFKA_HOME/config/kraft/server.properties"
    KAFKA_PID=$(lsof -ti :$KAFKA_PORT 2>/dev/null || echo "")
    echo "      Kafka:   PID $KAFKA_PID on port $KAFKA_PORT"

    # Create topics if they don't exist (idempotent)
    sleep 2
    for topic in \
        openemr.messages.clinic openemr.messages.patient \
        openemr.events.appointments openemr.events.patients openemr.events.clinical \
        openemr.notifications.email openemr.notifications.sms \
        openemr.audit.access openemr.direct.hl7; do
        "$KAFKA_HOME/bin/kafka-topics.sh" --create --topic "$topic" \
            --bootstrap-server "localhost:$KAFKA_PORT" --partitions 3 --replication-factor 1 2>/dev/null || true
    done
    echo "      Topics:   9 created/verified"
else
    echo "[1/3] Kafka skipped (START_KAFKA=$START_KAFKA or not installed)"
    echo "      Using in-memory event bus instead"
fi

# ── NestJS backend ──────────────────────────────────────────────
echo "[2/3] Building + starting NestJS..."
cd "$BACKEND_DIR"
npx nest build 2>&1
echo "      NestJS build complete."
PORT="$NEST_PORT" NODE_OPTIONS="--experimental-global-webcrypto" \
    nohup node dist/main.js > /tmp/nestjs-server.log 2>&1 &
NEST_PID=$!
echo "      NestJS:  PID $NEST_PID on port $NEST_PORT"

# ── Vite dev server ─────────────────────────────────────────────
echo "[3/3] Starting Vite dev server (HMR enabled)..."
cd "$SCRIPT_DIR"
nohup npx vite --port "$VITE_PORT" --host > /tmp/vite-server.log 2>&1 &
VITE_PID=$!
echo "      Vite:    PID $VITE_PID on port $VITE_PORT (hot reloads on save)"

sleep 3

# ── Banner ──────────────────────────────────────────────────────
echo ""
echo "  ╔══════════════════════════════════════════════════════════════╗"
echo "  ║  React SPA:    http://localhost:$VITE_PORT/app/                   ║"
echo "  ║  NestJS API:   http://localhost:$NEST_PORT/api                    ║"
echo "  ║  FHIR API:     http://localhost:$NEST_PORT/api/fhir               ║"
echo "  ║  WebSocket:    ws://localhost:$NEST_PORT/messaging                ║"
echo "  ║  Kafka:        localhost:$KAFKA_PORT                                    ║"
echo "  ║  Login:        admin / admin123                                   ║"
echo "  ╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  🔥 Frontend: Save .tsx/.ts → instant browser update (HMR)"
echo "  🔧 Backend:  Save .ts → bash dev-start.sh to rebuild"
echo "  📨 Messages: Kafka event bus + WebSocket real-time push"
echo ""
echo "  Press Ctrl+C to stop all servers."

wait
