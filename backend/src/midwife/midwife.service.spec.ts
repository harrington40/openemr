import { Test } from '@nestjs/testing';
import { MidwifeService } from './midwife.service';
import type { SaveAssessmentDto } from './midwife.service';
import { getDataSourceToken } from '@nestjs/typeorm';

/**
 * The duplicate guard is the interesting part: a double-clicked Save must not be
 * able to file the same assessment twice.
 */
describe('MidwifeService.saveAssessment duplicate guard', () => {
    const PATIENT = [{ id: 18, pid: 17, fname: 'Portal', lname: 'Test' }];

    function build(responder: (sql: string) => unknown) {
        const queries: string[] = [];
        // Only the SQL is inspected, so the bound parameters are not collected;
        // canned rows are assumed to match whatever row type the caller asks for.
        const dataSource = {
            query<T = unknown>(sql: string): Promise<T> {
                queries.push(sql);
                return Promise.resolve(responder(sql) as T);
            },
        };
        return { dataSource, queries };
    }

    async function service(dataSource: unknown) {
        const module = await Test.createTestingModule({
            providers: [
                MidwifeService,
                { provide: getDataSourceToken(), useValue: dataSource },
            ],
        }).compile();
        return module.get(MidwifeService);
    }

    const riskBody = {
        kind: 'risk' as const,
        risk: {
            age: 42,
            parity: 1,
            gestationWeeks: 30,
            bpSystolic: 120,
            bpDiastolic: 80,
            hemoglobin: 12,
            hasDiabetes: false,
            hasPreeclampsia: false,
        },
    };

    it('files the assessment when nothing identical was recorded recently', async () => {
        const { dataSource, queries } = build((sql) => {
            if (sql.includes('FROM patient_data')) return PATIENT;
            if (sql.includes('FROM midwife_assessments')) return []; // no duplicate
            return { insertId: 42 };
        });

        const result = await (
            await service(dataSource)
        ).saveAssessment(17, riskBody);

        expect(result).toMatchObject({ id: 42, score: 5, level: 'moderate' });
        expect(
            queries.some((q) => q.includes('INSERT INTO midwife_assessments')),
        ).toBe(true);
    });

    it('refuses a repeat of the same assessment and reports the existing one', async () => {
        const existing = {
            id: 7,
            pid: 17,
            kind: 'risk',
            summary: 'Risk Moderate Risk (score 5)',
            score: 5,
            level: 'moderate',
            apgar_1_total: null,
            apgar_5_total: null,
            recorded_at: new Date(),
        };
        const { dataSource, queries } = build((sql) => {
            if (sql.includes('FROM patient_data')) return PATIENT;
            if (sql.includes('FROM midwife_assessments')) return [existing];
            return { insertId: 99 };
        });

        const result = await (
            await service(dataSource)
        ).saveAssessment(17, riskBody);

        expect(result).toMatchObject({ id: 7, duplicate: true });
        // The critical assertion: nothing was inserted the second time.
        expect(
            queries.some((q) => q.includes('INSERT INTO midwife_assessments')),
        ).toBe(false);
    });

    it('scopes the check to the last five minutes', async () => {
        const { dataSource, queries } = build((sql) => {
            if (sql.includes('FROM patient_data')) return PATIENT;
            if (sql.includes('FROM midwife_assessments')) return [];
            return { insertId: 1 };
        });

        await (await service(dataSource)).saveAssessment(17, riskBody);

        const guard = queries.find((q) =>
            q.includes('FROM midwife_assessments'),
        );
        expect(guard).toContain('INTERVAL 5 MINUTE');
        expect(guard).toContain('score <=> ?'); // NULL-safe, so APGAR rows compare too
    });

    it('recomputes the score rather than trusting the request body', async () => {
        const { dataSource } = build((sql) => {
            if (sql.includes('FROM patient_data')) return PATIENT;
            if (sql.includes('FROM midwife_assessments')) return [];
            return { insertId: 3 };
        });

        // A body claiming a low score for high-risk inputs must not be honoured.
        const claimed: SaveAssessmentDto & { score: number; level: string } = {
            ...riskBody,
            score: 0,
            level: 'low',
        };
        const result = await (
            await service(dataSource)
        ).saveAssessment(17, claimed);

        expect(result.score).toBe(5);
        expect(result.level).toBe('moderate');
    });
});
