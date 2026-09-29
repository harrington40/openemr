import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ACTIVE_STATUSES, EmergencyService } from './emergency.service';
import { SmartRoutingService } from '../nursing/smart-routing.service';
import { BillingService } from '../billing/billing.service';
import { MessageProducer } from '../messaging/message-producer.service';

/**
 * The list a clinician's dashboard shows.
 *
 * "An emergency patient assigned to a doctor should also appear on that doctor's
 * dashboard, in the colour of their state." The colour has to be the *board's*
 * colour, so this method runs the rows through the same `decorate()` the board
 * uses rather than re-deriving a level. These tests hold the query to the active
 * statuses and to the assigned clinician, and hold the ordering to the board's:
 * sickest first, then longest waiting.
 */

/** A row shaped like VISIT_SELECT returns, with only the fields decorate reads. */
function visitRow(over: Record<string, unknown> = {}) {
    return {
        id: 41,
        pid: 37,
        patient_id: 51,
        fname: 'Peter',
        lname: 'Joe',
        public_id: 'RX-2609-00121',
        sex: 'Female',
        DOB: '1990-04-02',
        arrived_at: new Date(Date.now() - 90 * 60000), // 90 minutes ago
        mode: 'walk-in',
        chief_complaint: 'chest pain',
        esi_level: 2,
        news2: 6,
        triage_score: 12,
        shock_index: 0.8,
        status: 'waiting',
        room: 'Bay 2',
        provider_id: 6,
        target_minutes: 10,
        reassess_minutes: 15,
        needs_vitals: 0,
        vitals: '{}',
        bypass: null,
        modifiers: null,
        reasons: '["SpO2 92%"]',
        disposition: null,
        escalated_level: null,
        escalated_reason: null,
        escalated_at: null,
        first_seen_at: null,
        triaged_at: new Date(Date.now() - 85 * 60000),
        last_observation_at: null,
        ...over,
    };
}

async function buildService(rows: Array<ReturnType<typeof visitRow>>) {
    const seen: { sql: string; params: unknown[] }[] = [];
    const dataSource = {
        query: (sql: string, params?: unknown[]) => {
            seen.push({ sql, params: params || [] });
            return rows;
        },
    };
    // The routing/billing/messaging collaborators are not exercised by a read,
    // so empty stubs are registered for them.
    const module = await Test.createTestingModule({
        providers: [
            EmergencyService,
            { provide: getDataSourceToken(), useValue: dataSource },
            { provide: SmartRoutingService, useValue: {} },
            { provide: BillingService, useValue: {} },
            { provide: MessageProducer, useValue: {} },
        ],
    }).compile();

    return { service: module.get(EmergencyService), seen };
}

describe('EmergencyService.getActiveVisitsForProvider', () => {
    it('returns only the active attendances of the clinician asked for', async () => {
        const { service, seen } = await buildService([visitRow()]);
        const visits = await service.getActiveVisitsForProvider(6);

        expect(visits).toHaveLength(1);
        // The statuses and the provider must both be bound parameters, never inlined.
        const call = seen[0];
        expect(call.sql).toMatch(/v\.status IN \(\?, \?, \?\)/);
        expect(call.sql).toMatch(/v\.provider_id = \?/);
        expect(call.params).toEqual([...ACTIVE_STATUSES, 6]);
    });

    it("carries the triage colour and the board's breach arithmetic", async () => {
        const { service } = await buildService([visitRow({ esi_level: 2 })]);
        const [visit] = await service.getActiveVisitsForProvider(6);

        expect(visit.level).toBe(2);
        expect(visit.color).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(visit.label).toBeTruthy();
        // 90 minutes waited against a 10 minute target.
        expect(visit.waitMinutes).toBeGreaterThanOrEqual(89);
        expect(visit.targetMinutes).toBe(10);
        expect(visit.breached).toBe(true);
        expect(visit.overByMinutes).toBeGreaterThan(0);
    });

    it("orders sickest first, then longest waiting — the board's order", async () => {
        const { service } = await buildService([
            visitRow({
                id: 1,
                esi_level: 4,
                arrived_at: new Date(Date.now() - 200 * 60000),
            }),
            visitRow({
                id: 2,
                esi_level: 1,
                arrived_at: new Date(Date.now() - 5 * 60000),
            }),
            visitRow({
                id: 3,
                esi_level: 2,
                arrived_at: new Date(Date.now() - 30 * 60000),
            }),
            visitRow({
                id: 4,
                esi_level: 2,
                arrived_at: new Date(Date.now() - 70 * 60000),
            }),
        ]);
        const visits = await service.getActiveVisitsForProvider(6);

        expect(visits.map((v) => v.id)).toEqual([2, 4, 3, 1]);
    });

    it('does not query at all for a missing or nonsense clinician id', async () => {
        const { service, seen } = await buildService([visitRow()]);

        expect(await service.getActiveVisitsForProvider(0)).toEqual([]);
        expect(await service.getActiveVisitsForProvider(NaN)).toEqual([]);
        expect(await service.getActiveVisitsForProvider(-4)).toEqual([]);
        expect(seen).toHaveLength(0);
    });

    it('describes the patient the clinician will be looking for', async () => {
        const { service } = await buildService([visitRow()]);
        const [visit] = await service.getActiveVisitsForProvider(6);

        expect(visit.patientName).toBe('Peter Joe');
        expect(visit.patientPublicId).toBe('RX-2609-00121');
        expect(visit.room).toBe('Bay 2');
        expect(visit.chiefComplaint).toBe('chest pain');
        expect(visit.status).toBe('waiting');
    });
});
