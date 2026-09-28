/**
 * Generic event envelope flowing through the bus.
 * All Kafka topics / in-memory channels use this shape.
 */
export interface BusEvent<T = unknown> {
  /** Topic / channel name (e.g. openrx.messages.clinic) */
  topic: string;
  /** Unique event id (UUID v4) */
  eventId: string;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Event type discriminator */
  type: 'message' | 'appointment' | 'patient' | 'clinical' | 'notification' | 'audit' | 'direct';
  /** Priority for smart routing */
  priority: 'STAT' | 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';
  /** Who triggered this event */
  source: {
    userId?: number;
    facilityId?: number;
    module: string;
  };
  /** Event payload */
  payload: T;
  /** Optional correlation id for tracing */
  correlationId?: string;
}

/** Handler signature for consuming events */
export type EventHandler<T = unknown> = (event: BusEvent<T>) => Promise<void> | void;

/**
 * Abstraction over the event bus so we can swap
 * in-memory ↔ Kafka without changing business logic.
 */
export interface IEventBus {
  /** Publish an event to a topic */
  publish<T>(event: BusEvent<T>): Promise<void>;

  /** Subscribe a handler to a topic (returns unsubscribe fn) */
  subscribe<T>(topic: string, handler: EventHandler<T>): Promise<() => void>;

  /** Check if the bus is connected / healthy */
  isHealthy(): Promise<boolean>;

  /** Graceful shutdown */
  shutdown(): Promise<void>;
}

/** Options passed to the dynamic module */
export interface EventBusModuleOptions {
  adapter: 'in-memory' | 'kafka';
  /** Kafka broker list (only for kafka adapter) */
  brokers?: string[];
  /** Client id for kafka */
  clientId?: string;
}
