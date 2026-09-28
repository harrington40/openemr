import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { IEventBus, BusEvent } from '../event-bus/event-bus.interface';
import { DedupEngine } from './dedup-engine.service';
import type { Priority } from './priority-escalation.service';
import { PriorityEscalationService } from './priority-escalation.service';

export interface ProduceMessageDto {
  title: string;
  body: string;
  pid?: number | string;
  recipientId?: number;
  priority?: Priority;
  type?: 'clinic' | 'patient' | 'direct';
  userId?: number;
  facilityId?: number;
  attachmentName?: string;
}

export interface ProduceEventDto {
  type: 'appointment' | 'patient' | 'clinical';
  action: string;
  entityId: number | string;
  pid?: number | string;
  data?: any;
  userId?: number;
  facilityId?: number;
}

/**
 * Smart Message Router & Producer
 *
 * Routes messages to the correct Kafka topic based on type,
 * enriches with metadata, applies deduplication, and publishes
 * to the event bus.
 */
@Injectable()
export class MessageProducer {
  private readonly logger = new Logger(MessageProducer.name);

  constructor(
    @Inject('EVENT_BUS') private readonly eventBus: IEventBus,
    private readonly dedup: DedupEngine,
    private readonly escalation: PriorityEscalationService,
  ) {}

  /**
   * Produce a message event (internal clinic, patient-provider, or Direct).
   */
  async produceMessage(dto: ProduceMessageDto): Promise<{ eventId: string; topic: string }> {
    const type = dto.type || 'clinic';
    const priority = dto.priority || 'NORMAL';

    // Determine topic
    const topic = this.routeMessageTopic(type);

    // Build event
    const event: BusEvent = {
      topic,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'message',
      priority,
      source: {
        userId: dto.userId,
        facilityId: dto.facilityId,
        module: 'messaging',
      },
      payload: {
        title: dto.title,
        body: dto.body,
        pid: dto.pid ? Number(dto.pid) : undefined,
        recipientId: dto.recipientId,
        messageType: type,
        attachmentName: dto.attachmentName,
      },
    };

    // Dedup check
    if (this.dedup.isDuplicate(event)) {
      this.logger.warn(`Dedup blocked message: "${dto.title}"`);
      return { eventId: event.eventId, topic: 'dedup-blocked' };
    }

    // Track for escalation
    this.escalation.track(event);

    // Publish
    await this.eventBus.publish(event);
    this.logger.log(
      `Message routed → [${topic}] "${dto.title}" (${priority})`,
    );

    // High priority → also publish to notification topics
    if (priority === 'STAT' || priority === 'URGENT') {
      await this.publishNotification(event, 'email');
      if (priority === 'STAT') {
        await this.publishNotification(event, 'sms');
      }
    } else if (priority === 'HIGH') {
      await this.publishNotification(event, 'email');
    }

    return { eventId: event.eventId, topic };
  }

  /**
   * Produce a domain event (appointment created, patient registered, etc.).
   */
  async produceEvent(dto: ProduceEventDto): Promise<{ eventId: string; topic: string }> {
    const topic = this.routeEventTopic(dto.type);

    const event: BusEvent = {
      topic,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      type: dto.type,
      priority: 'NORMAL',
      source: {
        userId: dto.userId,
        facilityId: dto.facilityId,
        module: dto.type,
      },
      payload: {
        action: dto.action,
        entityId: dto.entityId,
        pid: dto.pid ? Number(dto.pid) : undefined,
        data: dto.data || {},
      },
    };

    if (this.dedup.isDuplicate(event)) {
      return { eventId: event.eventId, topic: 'dedup-blocked' };
    }

    await this.eventBus.publish(event);
    this.logger.log(`Event → [${topic}] ${dto.type}.${dto.action} #${dto.entityId}`);

    return { eventId: event.eventId, topic };
  }

  // ---- private ----

  private routeMessageTopic(type: string): string {
    switch (type) {
      case 'patient':
        return 'openrx.messages.patient';
      case 'direct':
        return 'openrx.direct.hl7';
      case 'clinic':
      default:
        return 'openrx.messages.clinic';
    }
  }

  private routeEventTopic(type: string): string {
    switch (type) {
      case 'appointment':
        return 'openrx.events.appointments';
      case 'patient':
        return 'openrx.events.patients';
      case 'clinical':
        return 'openrx.events.clinical';
      default:
        return 'openrx.events.clinical';
    }
  }

  private async publishNotification(event: BusEvent, channel: 'email' | 'sms'): Promise<void> {
    const notificationEvent: BusEvent = {
      ...event,
      topic: `openrx.notifications.${channel}`,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'notification',
    };

    await this.eventBus.publish(notificationEvent);
    this.logger.debug(`Notification queued → ${channel} for ${event.eventId}`);
  }
}
