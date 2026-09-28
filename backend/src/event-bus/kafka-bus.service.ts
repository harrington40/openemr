import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kafka, Producer, Consumer, EachMessagePayload } from 'kafkajs';
import { randomUUID } from 'crypto';
import { IEventBus, BusEvent, EventHandler } from './event-bus.interface';

/**
 * Kafka-backed event bus implementation using kafkajs.
 * Drop-in replacement for InMemoryBusService.
 *
 * Usage (in AppModule):
 *   EventBusModule.forRoot({ adapter: 'kafka', brokers: ['localhost:9092'] })
 */
@Injectable()
export class KafkaBusService implements IEventBus, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaBusService.name);
  private kafka: Kafka;
  private producer: Producer;
  private consumer: Consumer | null = null;
  private readonly handlers = new Map<string, EventHandler[]>();
  private connected = false;

  constructor(
    private readonly brokers: string[],
    private readonly clientId: string,
    private readonly groupId: string,
  ) {}

  async onModuleInit(): Promise<void> {
    this.kafka = new Kafka({
      clientId: this.clientId,
      brokers: this.brokers,
      retry: { retries: 3, initialRetryTime: 300 },
    });

    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
    });

    await this.producer.connect();
    this.connected = true;
    this.logger.log(`Kafka producer connected to ${this.brokers.join(',')}`);

    // Start consumer if there are any handlers
    if (this.handlers.size > 0) {
      await this.startConsumer();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  async publish<T>(event: BusEvent<T>): Promise<void> {
    if (!this.connected) {
      this.logger.warn('Kafka not connected, dropping event');
      return;
    }

    if (!event.eventId) event.eventId = randomUUID();
    if (!event.timestamp) event.timestamp = new Date().toISOString();

    await this.producer.send({
      topic: event.topic,
      messages: [
        {
          key: event.eventId,
          value: JSON.stringify(event),
          headers: {
            type: event.type,
            priority: event.priority,
            eventId: event.eventId,
          },
        },
      ],
    });

    this.logger.debug(`Published ${event.eventId} to ${event.topic}`);
  }

  async subscribe<T>(topic: string, handler: EventHandler<T>): Promise<() => void> {
    // Store handler
    const existing = this.handlers.get(topic) || [];
    existing.push(handler as EventHandler);
    this.handlers.set(topic, existing);

    // Restart consumer to pick up new topic
    if (this.connected && this.consumer) {
      await this.consumer.stop();
      await this.startConsumer();
    } else if (this.connected && !this.consumer) {
      await this.startConsumer();
    }

    return () => {
      const remaining = (this.handlers.get(topic) || []).filter((h) => h !== handler);
      if (remaining.length === 0) {
        this.handlers.delete(topic);
      } else {
        this.handlers.set(topic, remaining);
      }
    };
  }

  async isHealthy(): Promise<boolean> {
    return this.connected;
  }

  async shutdown(): Promise<void> {
    this.logger.log('Shutting down Kafka connections...');
    if (this.consumer) {
      try { await this.consumer.disconnect(); } catch {}
    }
    if (this.producer) {
      try { await this.producer.disconnect(); } catch {}
    }
    this.connected = false;
  }

  private async startConsumer(): Promise<void> {
    const topics = Array.from(this.handlers.keys());
    if (topics.length === 0) return;

    this.consumer = this.kafka.consumer({
      groupId: this.groupId,
      allowAutoTopicCreation: true,
      sessionTimeout: 30000,
    });

    await this.consumer.connect();
    await Promise.all(
      topics.map((topic) => this.consumer!.subscribe({ topic, fromBeginning: false })),
    );

    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        const { topic, message } = payload;
        const handlers = this.handlers.get(topic);
        if (!handlers || handlers.length === 0) return;

        try {
          const event: BusEvent = JSON.parse(message.value?.toString() || '{}');
          await Promise.all(handlers.map((h) => h(event)));
        } catch (err) {
          this.logger.error(`Error processing message from ${topic}: ${err}`);
        }
      },
    });

    this.logger.log(`Kafka consumer started for topics: ${topics.join(', ')}`);
  }
}
