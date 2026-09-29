import { Injectable, Logger } from '@nestjs/common';
import { BusEvent } from '../event-bus/event-bus.interface';

export type Priority = 'STAT' | 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';

interface EscalationRule {
    /** Max age before escalating to next level */
    maxAgeMinutes: number;
    /** Action to take on escalation */
    escalateTo: Priority | 'notify_supervisor' | 'create_recall';
}

interface EscalationState {
    eventId: string;
    originalPriority: Priority;
    currentPriority: Priority;
    createdAt: number; // epoch ms
    escalatedAt: number | null;
    escalationCount: number;
}

/**
 * Smart Priority Escalation Engine
 *
 * Tracks messages/events and escalates priority when they remain
 * unprocessed beyond configurable thresholds.
 *
 * Rules (from plan):
 *   STAT   → immediate delivery, push + SMS
 *   URGENT → within 5 min, push notification
 *   HIGH   → within 15 min, email notification
 *   NORMAL → within 1 hour, no notification
 *   LOW    → daily digest
 *
 * Escalation chain:
 *   Unread after 15 min → escalate to next level
 *   Unread after 1 hour → notify supervisor
 *   Unread after 24 hours → create recall task
 */
@Injectable()
export class PriorityEscalationService {
    private readonly logger = new Logger(PriorityEscalationService.name);
    private readonly tracked = new Map<string, EscalationState>();

    private readonly PRIORITY_ORDER: Priority[] = [
        'LOW',
        'NORMAL',
        'HIGH',
        'URGENT',
        'STAT',
    ];

    /** Escalation rules per priority level */
    private readonly RULES: Record<Priority, EscalationRule> = {
        STAT: { maxAgeMinutes: 5, escalateTo: 'notify_supervisor' },
        URGENT: { maxAgeMinutes: 15, escalateTo: 'notify_supervisor' },
        HIGH: { maxAgeMinutes: 60, escalateTo: 'create_recall' },
        NORMAL: { maxAgeMinutes: 240, escalateTo: 'create_recall' },
        LOW: { maxAgeMinutes: 1440, escalateTo: 'create_recall' },
    };

    /**
     * Register an event for tracking.
     */
    track(event: BusEvent): void {
        this.tracked.set(event.eventId, {
            eventId: event.eventId,
            originalPriority: event.priority,
            currentPriority: event.priority,
            createdAt: Date.now(),
            escalatedAt: null,
            escalationCount: 0,
        });
    }

    /**
     * Mark an event as handled (remove from tracking).
     */
    resolve(eventId: string): void {
        this.tracked.delete(eventId);
    }

    /**
     * Check all tracked events and return any that need escalation.
     * Called periodically by the consumer.
     */
    checkEscalations(): EscalationAction[] {
        const actions: EscalationAction[] = [];
        const now = Date.now();

        for (const [, state] of this.tracked.entries()) {
            const ageMinutes = (now - state.createdAt) / 60_000;
            const rule = this.RULES[state.currentPriority];

            if (ageMinutes >= rule.maxAgeMinutes) {
                const action = this.computeEscalation(state, rule, ageMinutes);
                if (action) {
                    actions.push(action);
                }
            }
        }

        return actions;
    }

    /**
     * Get stats for monitoring.
     */
    getStats(): { tracked: number; byPriority: Record<string, number> } {
        const byPriority: Record<string, number> = {};
        for (const [, state] of this.tracked.entries()) {
            byPriority[state.currentPriority] =
                (byPriority[state.currentPriority] || 0) + 1;
        }
        return { tracked: this.tracked.size, byPriority };
    }

    // --- private ---

    private computeEscalation(
        state: EscalationState,
        rule: EscalationRule,
        ageMinutes: number,
    ): EscalationAction | null {
        if (rule.escalateTo === 'notify_supervisor') {
            // Remove from tracking after notifying supervisor
            this.tracked.delete(state.eventId);
            this.logger.warn(
                `ESCALATION: ${state.eventId} (${state.originalPriority}) unhandled for ${Math.round(ageMinutes)}m → notifying supervisor`,
            );
            return {
                eventId: state.eventId,
                type: 'notify_supervisor',
                ageMinutes: Math.round(ageMinutes),
                originalPriority: state.originalPriority,
            };
        }

        if (rule.escalateTo === 'create_recall') {
            this.tracked.delete(state.eventId);
            this.logger.warn(
                `ESCALATION: ${state.eventId} (${state.originalPriority}) unhandled for ${Math.round(ageMinutes)}m → creating recall task`,
            );
            return {
                eventId: state.eventId,
                type: 'create_recall',
                ageMinutes: Math.round(ageMinutes),
                originalPriority: state.originalPriority,
            };
        }

        // Escalate to next priority level
        const nextPriority = rule.escalateTo;
        state.currentPriority = nextPriority;
        state.escalatedAt = Date.now();
        state.escalationCount++;

        this.logger.log(
            `ESCALATION: ${state.eventId} ${state.originalPriority} → ${nextPriority} (${Math.round(ageMinutes)}m)`,
        );

        return {
            eventId: state.eventId,
            type: 'escalate_priority',
            ageMinutes: Math.round(ageMinutes),
            originalPriority: state.originalPriority,
            newPriority: nextPriority,
        };
    }
}

export interface EscalationAction {
    eventId: string;
    type: 'escalate_priority' | 'notify_supervisor' | 'create_recall';
    ageMinutes: number;
    originalPriority: Priority;
    newPriority?: Priority;
}
