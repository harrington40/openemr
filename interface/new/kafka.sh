#!/usr/bin/env bash
# OpenEMR Kafka Control Script
# Usage: bash kafka.sh [start|stop|status|topics|reset]

KAFKA_HOME="/opt/kafka"
KAFKA_PORT="${KAFKA_PORT:-9092}"
ACTION="${1:-status}"

kafka_status() {
    if lsof -ti :$KAFKA_PORT > /dev/null 2>&1; then
        echo "✅ Kafka is RUNNING on port $KAFKA_PORT"
        echo "   Broker: localhost:$KAFKA_PORT"
        echo "   Topics:"
        "$KAFKA_HOME/bin/kafka-topics.sh" --list --bootstrap-server "localhost:$KAFKA_PORT" 2>/dev/null | sed 's/^/     • /'
    else
        echo "❌ Kafka is NOT running on port $KAFKA_PORT"
    fi
}

kafka_start() {
    if lsof -ti :$KAFKA_PORT > /dev/null 2>&1; then
        echo "Kafka is already running on port $KAFKA_PORT"
        return 0
    fi

    if [ ! -f "$KAFKA_HOME/bin/kafka-server-start.sh" ]; then
        echo "ERROR: Kafka not found at $KAFKA_HOME"
        echo "Install: cd /tmp && curl -L -o kafka.tgz https://archive.apache.org/dist/kafka/3.9.0/kafka_2.13-3.9.0.tgz"
        echo "         cd /opt && tar xzf /tmp/kafka.tgz && mv kafka_2.13-3.9.0 kafka"
        return 1
    fi

    echo "Starting Kafka (KRaft, no Zookeeper)..."

    # Format storage if first run
    if [ ! -d /tmp/kraft-combined-logs ]; then
        CLUSTER_ID=$("$KAFKA_HOME/bin/kafka-storage.sh" random-uuid)
        "$KAFKA_HOME/bin/kafka-storage.sh" format -t "$CLUSTER_ID" -c "$KAFKA_HOME/config/kraft/server.properties" > /dev/null 2>&1
        echo "  Storage formatted (cluster: $CLUSTER_ID)"
    fi

    "$KAFKA_HOME/bin/kafka-server-start.sh" -daemon "$KAFKA_HOME/config/kraft/server.properties"
    sleep 3

    if lsof -ti :$KAFKA_PORT > /dev/null 2>&1; then
        echo "  Kafka started on port $KAFKA_PORT"

        # Create OpenEMR topics
        for topic in \
            openemr.messages.clinic openemr.messages.patient \
            openemr.events.appointments openemr.events.patients openemr.events.clinical \
            openemr.notifications.email openemr.notifications.sms \
            openemr.audit.access openemr.direct.hl7; do
            "$KAFKA_HOME/bin/kafka-topics.sh" --create --topic "$topic" \
                --bootstrap-server "localhost:$KAFKA_PORT" --partitions 3 --replication-factor 1 2>/dev/null || true
        done
        echo "  9 topics created/verified"
    else
        echo "  ERROR: Kafka failed to start. Check /tmp/kafka.log"
        return 1
    fi
}

kafka_stop() {
    if lsof -ti :$KAFKA_PORT > /dev/null 2>&1; then
        echo "Stopping Kafka..."
        lsof -ti :$KAFKA_PORT | xargs -r kill 2>/dev/null || true
        sleep 2
        echo "  Kafka stopped"
    else
        echo "Kafka is not running"
    fi
}

kafka_topics() {
    echo "=== Kafka Topics ==="
    "$KAFKA_HOME/bin/kafka-topics.sh" --list --bootstrap-server "localhost:$KAFKA_PORT" 2>/dev/null
    echo ""
    echo "=== Consumer Groups ==="
    "$KAFKA_HOME/bin/kafka-consumer-groups.sh" --list --bootstrap-server "localhost:$KAFKA_PORT" 2>/dev/null || echo "  (none active)"
}

kafka_reset() {
    echo "WARNING: This will DELETE ALL Kafka data!"
    read -rp "Are you sure? [y/N] " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "Aborted."
        return 0
    fi

    kafka_stop
    sleep 2
    rm -rf /tmp/kraft-combined-logs
    echo "Kafka data reset. Run 'bash kafka.sh start' to restart."
}

case "$ACTION" in
    start)   kafka_start ;;
    stop)    kafka_stop ;;
    status)  kafka_status ;;
    topics)  kafka_topics ;;
    reset)   kafka_reset ;;
    *)
        echo "Usage: bash kafka.sh [start|stop|status|topics|reset]"
        ;;
esac
