# OpenEMR — Kafka Messaging Integration Plan

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                      React SPA (Browser)                     │
│  ┌─────────┐ ┌──────────┐ ┌────────────┐ ┌────────────────┐ │
│  │Messages │ │Recall    │ │Direct Msg  │ │Notifications   │ │
│  │  Page   │ │ Board    │ │   Page     │ │ (Toast/Real)   │ │
│  └────┬────┘ └────┬─────┘ └─────┬──────┘ └───────┬────────┘ │
│       │           │             │                 │          │
│       └───────────┴──────┬──────┴─────────────────┘          │
│                          │ WebSocket (socket.io)              │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────┐
│                   NestJS Backend :3002                        │
│                          │                                    │
│  ┌───────────────────────┼───────────────────────────────┐   │
│  │              Message Gateway Module                    │   │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │   │
│  │  │Producer │ │Consumer  │ │Router    │ │WebSocket │  │   │
│  │  │Service  │ │Service   │ │Service   │ │Gateway   │  │   │
│  │  └────┬────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘  │   │
│  └───────┼───────────┼────────────┼────────────┼────────┘   │
│          │           │            │            │              │
│  ┌───────┼───────────┼────────────┼────────────┼────────┐   │
│  │       ▼           ▼            ▼            ▼        │   │
│  │          Event Bus Abstraction Layer                 │   │
│  │  ┌──────────────┐  ┌─────────────────────────────┐  │   │
│  │  │ Kafka Adapter │  │ In-Memory Adapter (dev)     │  │   │
│  │  │ (production)  │  │ EventEmitter + Queue        │  │   │
│  │  └──────────────┘  └─────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

## Kafka Topic Architecture

### Topics (by concern)

| Topic | Purpose | Partition Key | Retention |
|-------|---------|---------------|-----------|
| `openemr.messages.clinic` | Internal clinic messages | `recipient_id` | 90 days |
| `openemr.messages.patient` | Patient-provider messages | `patient_id` | 90 days |
| `openemr.events.appointments` | Appointment events (created, updated, cancelled) | `appointment_id` | 30 days |
| `openemr.events.patients` | Patient events (registered, updated) | `patient_id` | 365 days |
| `openemr.events.clinical` | Clinical events (encounter created, lab result) | `patient_id` | 365 days |
| `openemr.notifications.email` | Email notification queue | `recipient_id` | 7 days |
| `openemr.notifications.sms` | SMS notification queue | `phone_number` | 7 days |
| `openemr.audit.access` | Access audit log | `user_id` | 365 days |
| `openemr.direct.hl7` | HL7/Direct messages | `message_id` | 90 days |

### Consumer Groups

| Group | Topics | Handler |
|-------|--------|---------|
| `openemr-notification-email` | `openemr.notifications.email` | EmailSender |
| `openemr-notification-sms` | `openemr.notifications.sms` | SmsSender |
| `openemr-audit-logger` | `openemr.audit.access` | AuditLogger |
| `openemr-message-indexer` | `openemr.messages.*` | MessageIndexer |
| `openemr-recall-checker` | `openemr.events.appointments` | RecallChecker |
| `openemr-direct-hl7` | `openemr.direct.hl7` | HL7Processor |

## Smart Algorithm: Message Router

```
┌─────────────────────────────────────────────────────────┐
│              Smart Message Router Algorithm               │
├─────────────────────────────────────────────────────────┤
│ 1. RECEIVE message {type, from, to, body, priority}      │
│ 2. CLASSIFY type:                                        │
│    - clinic → openemr.messages.clinic                     │
│    - patient → openemr.messages.patient                   │
│    - appointment → openemr.events.appointments            │
│    - clinical → openemr.events.clinical                   │
│ 3. ENRICH with metadata (timestamp, facility, provider)   │
│ 4. ROUTE to topic based on type + priority                │
│ 5. NOTIFY consumers via WebSocket if online                │
│ 6. QUEUE notification if priority >= threshold             │
│    - High: immediate email + SMS                           │
│    - Medium: batch every 15 min                            │
│    - Low: daily digest                                     │
└─────────────────────────────────────────────────────────┘
```

## Smart Algorithm: Deduplication Engine

```typescript
interface DedupKey {
  messageHash: string;    // SHA-256 of body + timestamp
  senderId: number;
  recipientId: number;
  windowMs: number;       // Dedup window (default 5 min)
}

function isDuplicate(msg: Message, recentMessages: Map<string, number>): boolean {
  const key = `${msg.type}:${msg.from}:${msg.to}`;
  const lastSeen = recentMessages.get(key);
  if (lastSeen && (Date.now() - lastSeen) < 300000) {
    // Same sender/recipient/type within 5 min → likely duplicate
    return true;
  }
  recentMessages.set(key, Date.now());
  return false;
}
```

## Smart Algorithm: Priority Escalation

```
Priority Levels:
  STAT   → Immediate delivery, push notification, SMS
  URGENT → Deliver within 5 min, push notification
  HIGH   → Deliver within 15 min, email notification
  NORMAL → Deliver within 1 hour, no notification
  LOW    → Daily digest

Escalation Rules:
  - Unread after 15 min → escalate to next level
  - Unread after 1 hour → notify supervisor
  - Unread after 24 hours → create recall task
```

## Implementation Phases

### Phase 1: Event Bus Abstraction (in-memory, production-ready API)

Files to create:
- `backend/src/event-bus/event-bus.interface.ts` — IEventBus interface
- `backend/src/event-bus/in-memory-bus.service.ts` — In-memory implementation using EventEmitter2
- `backend/src/event-bus/event-bus.module.ts` — Dynamic module (pluggable)
- `backend/src/messaging/messaging-gateway.ts` — WebSocket gateway (socket.io)
- `backend/src/messaging/message-producer.service.ts` — Producer service
- `backend/src/messaging/message-consumer.service.ts` — Consumer with smart routing

### Phase 2: Kafka Adapter (production swap)

- `backend/src/event-bus/kafka-bus.service.ts` — Kafka implementation using kafkajs
- Docker Compose entry for Kafka + Zookeeper/KRaft

### Phase 3: Real-time Frontend

- Socket.io client in React SPA
- Real-time message notifications (toast)
- Live message thread updates
- Typing indicators

### Phase 4: Advanced Features

- Message read receipts
- Message threading
- Attachment handling via Kafka chunks
- Dead Letter Queue for failed messages

## Current State → Target State

| Component | Current | Target |
|-----------|---------|--------|
| Message delivery | REST POST → DB insert | Kafka topic → consumer → DB + WebSocket |
| Notifications | Manual message creation | Event-driven auto-notification |
| Real-time updates | None (page refresh) | WebSocket push |
| Audit logging | None | Kafka audit topic |
| HL7/Direct | Basic REST | Kafka-backed reliable delivery |
| Scalability | Single process | Horizontally scalable consumers |

## Development Approach

For MVP, implement with the **in-memory event bus** that mirrors Kafka's API. This gives us:

1. Same producer/consumer API as Kafka
2. No infrastructure dependencies
3. Instant development feedback
4. Drop-in Kafka replacement via adapter pattern

When ready for production:
```typescript
// Development
EventBusModule.forRoot({ adapter: 'in-memory' })

// Production
EventBusModule.forRoot({ adapter: 'kafka', brokers: ['kafka:9092'] })
```
