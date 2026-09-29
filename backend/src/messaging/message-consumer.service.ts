import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
    IEventBus,
    BusEvent,
    EventHandler,
} from '../event-bus/event-bus.interface';
import { DedupEngine } from './dedup-engine.service';
import {
    PriorityEscalationService,
    EscalationAction,
} from './priority-escalation.service';

/** Payload carried by the message/event bus events consumed here. */
interface MessageEventPayload {
    title?: string;
    body?: string;
    pid?: number | string;
    priority?: string;
    action?: string;
    entityId?: number | string;
    recipientId?: number | string;
}

/**
 * Message Consumer Service
 *
 * Subscribes to all message/event topics via the event bus,
 * processes events (DB persistence, notifications, audit),
 * and manages the priority escalation loop.
 */
@Injectable()
export class MessageConsumer implements OnModuleInit {
    private readonly logger = new Logger(MessageConsumer.name);
    private unsubscribeFns: Array<() => void> = [];
    private escalationInterval: ReturnType<typeof setInterval> | null = null;

    constructor(
        @Inject('EVENT_BUS') private readonly eventBus: IEventBus,
        @Inject(DataSource) private readonly dataSource: DataSource,
        private readonly dedup: DedupEngine,
        private readonly escalation: PriorityEscalationService,
    ) {}

    async onModuleInit(): Promise<void> {
        // Subscribe to message topics
        await this.subscribeToTopic(
            'openrx.messages.clinic',
            this.handleClinicMessage.bind(this),
        );
        await this.subscribeToTopic(
            'openrx.messages.patient',
            this.handlePatientMessage.bind(this),
        );
        await this.subscribeToTopic(
            'openrx.direct.hl7',
            this.handleDirectMessage.bind(this),
        );

        // Subscribe to event topics
        await this.subscribeToTopic(
            'openrx.events.appointments',
            this.handleAppointmentEvent.bind(this),
        );
        await this.subscribeToTopic(
            'openrx.events.patients',
            this.handlePatientEvent.bind(this),
        );
        await this.subscribeToTopic(
            'openrx.events.clinical',
            this.handleClinicalEvent.bind(this),
        );

        // Subscribe to notification topics
        await this.subscribeToTopic(
            'openrx.notifications.email',
            this.handleEmailNotification.bind(this),
        );
        await this.subscribeToTopic(
            'openrx.notifications.sms',
            this.handleSmsNotification.bind(this),
        );

        // Audit logging topic
        await this.subscribeToTopic(
            'openrx.audit.access',
            this.handleAuditEvent.bind(this),
        );

        // Start escalation checker (every 60 seconds)
        this.escalationInterval = setInterval(() => {
            void this.runEscalationCheck();
        }, 60_000);

        this.logger.log('MessageConsumer subscribed to all topics');
    }

    // ---- Message handlers ----

    private async handleClinicMessage(event: BusEvent): Promise<void> {
        const payload = (event.payload ?? {}) as MessageEventPayload;
        await this.persistMessage(event, 'clinic');
        this.escalation.resolve(event.eventId);
        this.logger.log(`Clinic message persisted: "${payload.title}"`);
    }

    private async handlePatientMessage(event: BusEvent): Promise<void> {
        const payload = (event.payload ?? {}) as MessageEventPayload;
        await this.persistMessage(event, 'patient');
        this.escalation.resolve(event.eventId);
        this.logger.log(`Patient message persisted: "${payload.title}"`);
    }

    private async handleDirectMessage(event: BusEvent): Promise<void> {
        const payload = (event.payload ?? {}) as MessageEventPayload;
        await this.persistMessage(event, 'direct');
        this.escalation.resolve(event.eventId);
        this.logger.log(`Direct message persisted: "${payload.title}"`);
    }

    private handleAppointmentEvent(event: BusEvent): void {
        const payload = (event.payload ?? {}) as MessageEventPayload;
        this.logger.log(
            `Appointment event: ${payload.action} #${payload.entityId}`,
        );

        // Example: if appointment is cancelled, could trigger recall check
        if (payload.action === 'cancelled' || payload.action === 'no-show') {
            this.logger.log(
                `Recall check triggered for patient #${payload.pid}`,
            );
        }
    }

    private handlePatientEvent(event: BusEvent): void {
        const payload = (event.payload ?? {}) as MessageEventPayload;
        this.logger.log(
            `Patient event: ${payload.action} #${payload.entityId}`,
        );
    }

    private handleClinicalEvent(event: BusEvent): void {
        const payload = (event.payload ?? {}) as MessageEventPayload;
        this.logger.log(
            `Clinical event: ${payload.action} #${payload.entityId}`,
        );
    }

    private handleEmailNotification(event: BusEvent): void {
        const payload = (event.payload ?? {}) as MessageEventPayload;
        this.logger.log(
            `[EMAIL] Would send to user #${event.source?.userId}: "${payload.title}"`,
        );
        // TODO: Integrate with actual email service (SMTP, SendGrid, etc.)
    }

    private handleSmsNotification(event: BusEvent): void {
        const payload = (event.payload ?? {}) as MessageEventPayload;
        this.logger.log(
            `[SMS] Would send to user #${event.source?.userId}: "${payload.title}"`,
        );
        // TODO: Integrate with actual SMS service (Twilio, etc.)
    }

    private async handleAuditEvent(event: BusEvent): Promise<void> {
        const payload = (event.payload ?? {}) as MessageEventPayload;
        this.logger.log(
            `[AUDIT] ${event.type} by user #${event.source?.userId}`,
        );
        try {
            await this.dataSource.query(
                `INSERT INTO log (date, event, user, patientid, groupname, comments)
         VALUES (NOW(), ?, ?, ?, ?, ?)`,
                [
                    event.type,
                    event.source?.userId
                        ? String(event.source.userId)
                        : 'system',
                    payload.pid || 0,
                    'events',
                    JSON.stringify(event.payload),
                ],
            );
        } catch (err) {
            this.logger.error(`Failed to write audit log: ${err}`);
        }
    }

    // ---- Helpers ----

    private async persistMessage(
        event: BusEvent,
        messageType: string,
    ): Promise<void> {
        const payload = (event.payload ?? {}) as MessageEventPayload;
        const priority = event.priority || payload.priority || 'NORMAL';
        const priPrefix =
            priority === 'NORMAL' || priority === 'LOW' ? '' : `[${priority}] `;
        try {
            await this.dataSource.query(
                `INSERT INTO pnotes (date, title, body, pid, user, groupname, message_status, assigned_to)
         VALUES (NOW(), ?, ?, ?, ?, ?, 'New', ?)`,
                [
                    `${priPrefix}[${messageType.toUpperCase()}] ${payload.title || 'No Subject'}`,
                    payload.body || '',
                    payload.pid || 0,
                    event.source?.userId
                        ? String(event.source.userId)
                        : 'system',
                    'events',
                    payload.recipientId ? String(payload.recipientId) : '',
                ],
            );
        } catch (err) {
            this.logger.error(`Failed to persist message: ${err}`);
        }
    }

    private async subscribeToTopic(
        topic: string,
        handler: EventHandler,
    ): Promise<void> {
        const unsub = await this.eventBus.subscribe(topic, handler);
        this.unsubscribeFns.push(unsub);
    }

    /**
     * Periodic escalation check.
     * Processes any messages that have exceeded their priority thresholds.
     */
    private async runEscalationCheck(): Promise<void> {
        try {
            const actions = this.escalation.checkEscalations();
            for (const action of actions) {
                await this.processEscalation(action);
            }
            if (actions.length > 0) {
                this.logger.log(
                    `Escalation check: ${actions.length} actions taken`,
                );
            }
        } catch (err) {
            this.logger.error(`Escalation check failed: ${err}`);
        }
    }

    private async processEscalation(action: EscalationAction): Promise<void> {
        switch (action.type) {
            case 'escalate_priority':
                // Re-publish with higher priority
                this.logger.warn(
                    `Escalated ${action.eventId} to ${action.newPriority} (${action.ageMinutes}m old)`,
                );
                break;

            case 'notify_supervisor':
                // Create supervisor notification in pnotes
                try {
                    await this.dataSource.query(
                        `INSERT INTO pnotes (date, title, body, pid, user, groupname, message_status)
             VALUES (NOW(), ?, ?, 0, 'system', 'escalation', 'New')`,
                        [
                            'ESCALATION: Unhandled message',
                            `Event ${action.eventId} (${action.originalPriority}) was unhandled for ${action.ageMinutes} minutes.`,
                        ],
                    );
                } catch (err) {
                    this.logger.error(
                        `Failed to create supervisor notification: ${err}`,
                    );
                }
                break;

            case 'create_recall':
                // Log recall task creation
                this.logger.warn(
                    `RECALL TASK: Event ${action.eventId} unhandled for ${action.ageMinutes}m`,
                );
                try {
                    await this.dataSource.query(
                        `INSERT INTO pnotes (date, title, body, pid, user, groupname, message_status)
             VALUES (NOW(), ?, ?, 0, 'system', 'recall', 'New')`,
                        [
                            'RECALL: Unhandled message',
                            `Event ${action.eventId} (${action.originalPriority}) was unhandled for ${action.ageMinutes} minutes. Recall task created.`,
                        ],
                    );
                } catch (err) {
                    this.logger.error(`Failed to create recall task: ${err}`);
                }
                break;
        }
    }
}
