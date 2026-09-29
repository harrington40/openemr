import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ProviderService } from './provider.service';
import { EmergencyService } from '../emergency/emergency.service';

/**
 * The dashboard carries the clinician's live emergency patients.
 *
 * "An emergency patient assigned to any doctor should also appear in the provider
 * dashboard with the colour of the state of the patient." The colour comes from the
 * emergency module, so this asserts the dashboard asks it for the signed-in
 * clinician and passes the answer straight through — plus the counts the header
 * shows, including a breached count, because a patient in a corridor past their
 * target is the thing a dashboard must not hide.
 */
/** Shape of the decorated emergency visit used by the dashboard. */
interface EmergencyVisitLike {
    level: number;
    color: string;
    label: string;
    breached: boolean;
    waitMinutes: number;
    patientName: string;
}

describe('ProviderService.getDashboard emergency section', () => {
    const PROVIDER = [
        {
            id: 6,
            username: 'schen',
            fname: 'Sarah',
            lname: 'Chen',
            title: 'Dr.',
            calendar_color: '#198754',
        },
    ];

    const edVisits = [
        {
            id: 41,
            level: 2,
            color: '#fd7e14',
            label: 'Orange',
            breached: true,
            waitMinutes: 42,
            patientName: 'Peter Joe',
        },
        {
            id: 42,
            level: 4,
            color: '#198754',
            label: 'Green',
            breached: false,
            waitMinutes: 6,
            patientName: 'Ada Bility',
        },
    ];

    async function build(visits: EmergencyVisitLike[] = edVisits) {
        const asked: number[] = [];
        const dataSource = {
            query: (sql: string) => {
                if (sql.includes('FROM users WHERE id = ?')) return PROVIDER;
                if (sql.includes('as totalPatients')) {
                    return [
                        {
                            totalPatients: 3,
                            todayAppointments: 1,
                            completed: 0,
                            pending: 1,
                        },
                    ];
                }
                return []; // appointments, assigned patients, recent encounters
            },
        };
        const emergency = {
            getActiveVisitsForProvider: (providerId: number) => {
                asked.push(providerId);
                return visits;
            },
        };

        const module = await Test.createTestingModule({
            providers: [
                ProviderService,
                { provide: getDataSourceToken(), useValue: dataSource },
                { provide: EmergencyService, useValue: emergency },
            ],
        }).compile();

        return { service: module.get(ProviderService), asked };
    }

    it('asks the emergency service for this clinician and returns what it says', async () => {
        const { service, asked } = await build();
        const dashboard = await service.getDashboard(6);
        if (!dashboard) throw new Error('dashboard expected');

        expect(asked).toEqual([6]);
        expect(dashboard.emergencyPatients).toHaveLength(2);
        // Colour and level pass through untouched, so the dashboard and the board agree.
        expect(dashboard.emergencyPatients[0]).toMatchObject({
            level: 2,
            color: '#fd7e14',
            label: 'Orange',
        });
    });

    it('summarises the department for the header', async () => {
        const { service } = await build();
        const dashboard = await service.getDashboard(6);
        if (!dashboard) throw new Error('dashboard expected');

        expect(dashboard.emergency).toEqual({
            active: 2,
            breached: 1,
            sickestLevel: 2,
        });
    });

    it('reports nothing rather than guessing when the clinician has no one in the department', async () => {
        const { service } = await build([]);
        const dashboard = await service.getDashboard(6);
        if (!dashboard) throw new Error('dashboard expected');

        expect(dashboard.emergencyPatients).toEqual([]);
        // null, not 5: "nobody in the department" is not "everyone is Green".
        expect(dashboard.emergency).toEqual({
            active: 0,
            breached: 0,
            sickestLevel: null,
        });
    });

    it('leaves the rest of the dashboard intact', async () => {
        const { service } = await build();
        const dashboard = await service.getDashboard(6);
        if (!dashboard) throw new Error('dashboard expected');

        expect(dashboard.provider.id).toBe(6);
        expect(dashboard.stats.totalPatients).toBe(3);
        expect(dashboard.assignedPatients).toEqual([]);
        expect(dashboard.todayAppointments).toEqual([]);
    });
});
