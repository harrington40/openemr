import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Subject, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { randomUUID, createHash } from 'crypto';
import { IEventBus, BusEvent, EventHandler } from './event-bus.interface';

/** Payload fields consulted when building the dedup key. */
interface BusEventPayload {
    recipientId?: number | string;
    to?: number | string;
    pid?: number | string;
    messageId?: number | string;
    eventId?: string;
    title?: string;
    body?: string;
}

/**
 * In-memory event bus using RxJS Subjects.
 * Mirrors Kafka's publish/subscribe API so swapping adapters
 * is a one-line config change.
 */
@Injectable()
export class InMemoryBusService implements IEventBus, OnModuleDestroy {
    private readonly logger = new Logger(InMemoryBusService.name);

    /** Topic → Subject */
    private readonly streams = new Map<string, Subject<BusEvent>>();

    /** Active subscriptions (for cleanup) */
    private readonly subscriptions = new Map<string, Subscription[]>();

    /** Recent message dedup cache (topic:type:from:to → timestamp) */
    private readonly dedupCache = new Map<string, number>();

    /** Dedup window in ms (default 5 minutes) */
    private readonly dedupWindowMs = 300_000;

    publish<T>(event: BusEvent<T>): Promise<void> {
        // Assign eventId if not already set
        if (!event.eventId) {
            event.eventId = randomUUID();
        }
        if (!event.timestamp) {
            event.timestamp = new Date().toISOString();
        }

        // Dedup check
        if (this.isDuplicate(event)) {
            this.logger.debug(
                `Dropping duplicate event ${event.eventId} on topic ${event.topic}`,
            );
            return Promise.resolve();
        }

        const stream = this.getOrCreateStream(event.topic);
        this.logger.log(
            `[${event.topic}] ${event.type} (${event.priority}) — ${event.eventId}`,
        );
        stream.next(event);
        return Promise.resolve();
    }

    subscribe<T>(topic: string, handler: EventHandler<T>): Promise<() => void> {
        const stream = this.getOrCreateStream(topic);
        const sub = stream.pipe(filter((e) => e.topic === topic)).subscribe({
            next: (event) => {
                try {
                    // Delivery is fire-and-forget: a publisher must not block on the
                    // handler, so the returned promise is intentionally not awaited.
                    void handler(event as BusEvent<T>);
                } catch (err) {
                    this.logger.error(
                        `Handler error on topic ${topic}: ${err}`,
                        (err as Error).stack,
                    );
                }
            },
            error: (err) =>
                this.logger.error(`Stream error on topic ${topic}: ${err}`),
        });

        // Track subscription for cleanup
        const subs = this.subscriptions.get(topic) || [];
        subs.push(sub);
        this.subscriptions.set(topic, subs);

        return Promise.resolve(() => {
            sub.unsubscribe();
            const remaining = (this.subscriptions.get(topic) || []).filter(
                (s) => s !== sub,
            );
            if (remaining.length === 0) {
                this.subscriptions.delete(topic);
            } else {
                this.subscriptions.set(topic, remaining);
            }
        });
    }

    isHealthy(): Promise<boolean> {
        // In-memory is always healthy
        return Promise.resolve(true);
    }

    shutdown(): Promise<void> {
        this.logger.log('Shutting down in-memory event bus...');
        for (const [, subs] of this.subscriptions.entries()) {
            subs.forEach((s) => s.unsubscribe());
        }
        this.subscriptions.clear();

        for (const [, stream] of this.streams.entries()) {
            stream.complete();
        }
        this.streams.clear();
        this.dedupCache.clear();
        return Promise.resolve();
    }

    onModuleDestroy(): void {
        // The body above runs synchronously; the promise is only there to satisfy
        // the interface, so it does not need to be awaited.
        void this.shutdown();
    }

    // ---- private helpers ----

    private getOrCreateStream(topic: string): Subject<BusEvent> {
        if (!this.streams.has(topic)) {
            this.streams.set(topic, new Subject<BusEvent>());
        }
        return this.streams.get(topic)!;
    }

    /**
     * Smart deduplication: same content, same recipient, same patient, same topic,
     * inside the dedup window.
     *
     * Both the recipient *and* the patient must be part of the key, which is how
     * two bugs showed up here:
     *  - keying on `payload.pid` first meant one page addressed to two nurses
     *    collided with itself and only the first was ever delivered;
     *  - dropping the patient when a recipient was present meant two different
     *    patients with the same complaint and the same waiting time were collapsed
     *    as duplicates, because the patient's name lives in the title while the
     *    content hash covers the body.
     */
    private isDuplicate(event: BusEvent): boolean {
        const payload = (event.payload ?? {}) as BusEventPayload;
        const recipientId = payload.recipientId ?? payload.to ?? '';
        const patient = payload.pid ?? '';
        const dedupeNonce = payload.messageId || payload.eventId || '';
        const content = createHash('sha1')
            .update(`${payload.title || ''}|${payload.body || ''}`)
            .digest('hex')
            .slice(0, 12);
        const key = `${event.topic}:${event.type}:${event.source?.userId || 'anon'}:r${recipientId}:p${patient}:${dedupeNonce}:${content}`;
        const lastSeen = this.dedupCache.get(key);
        const now = Date.now();

        if (lastSeen && now - lastSeen < this.dedupWindowMs) {
            return true;
        }
        this.dedupCache.set(key, now);

        // Clean up old entries periodically
        if (this.dedupCache.size > 10_000) {
            for (const [k, ts] of this.dedupCache.entries()) {
                if (now - ts > this.dedupWindowMs * 2) {
                    this.dedupCache.delete(k);
                }
            }
        }

        return false;
    }
}
