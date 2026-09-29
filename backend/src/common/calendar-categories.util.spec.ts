import {
    resolveVisitCategoryId,
    DEFAULT_VISIT_CATEGORY,
} from './calendar-categories.util';

/** Minimal stand-in for the DataSource, returning canned rows per query. */
function mockDataSource(
    responder: (sql: string, params?: unknown[]) => unknown,
) {
    const calls: { sql: string; params?: unknown[] }[] = [];
    // The canned rows are assumed to match whatever row type the caller asks
    // for, which is how the helper narrows them.
    const dataSource = {
        query<T = unknown>(sql: string, params?: unknown[]): Promise<T> {
            calls.push({ sql, params });
            return Promise.resolve(responder(sql, params) as T);
        },
    };
    return { dataSource, calls };
}

describe('resolveVisitCategoryId', () => {
    it('keeps the preferred id when that category still exists', async () => {
        const { dataSource } = mockDataSource(() => [{ pc_catid: 5 }]);
        await expect(resolveVisitCategoryId(dataSource, 5)).resolves.toBe(5);
    });

    it('falls back when the preferred category was deleted', async () => {
        // This is the failure that orphaned 23 appointments and 59 encounters: the
        // literal 5 was written without checking that the row still existed.
        const { dataSource, calls } = mockDataSource((sql) => {
            if (sql.includes('WHERE pc_catid = ?')) return [];
            if (sql.includes('pc_cattype = ?')) return [{ pc_catid: 16 }];
            return [];
        });

        await expect(resolveVisitCategoryId(dataSource, 5)).resolves.toBe(16);
        expect(calls.some((c) => c.sql.includes('pc_cattype = ?'))).toBe(true);
    });

    it('ignores an absent or nonsense id and uses an active appointment category', async () => {
        for (const bad of [undefined, null, '', 0, -3, 'abc']) {
            const { dataSource } = mockDataSource((sql) =>
                sql.includes('pc_cattype = ?') ? [{ pc_catid: 16 }] : [],
            );
            await expect(resolveVisitCategoryId(dataSource, bad)).resolves.toBe(
                16,
            );
        }
    });

    it('looks the standard visit category up by name before creating one', async () => {
        const { dataSource, calls } = mockDataSource((sql) => {
            if (sql.includes('pc_catname = ?')) return [{ pc_catid: 9 }];
            return [];
        });

        await expect(resolveVisitCategoryId(dataSource)).resolves.toBe(9);
        expect(
            calls.some((c) => c.params?.[0] === DEFAULT_VISIT_CATEGORY),
        ).toBe(true);
        expect(calls.some((c) => c.sql.includes('INSERT INTO'))).toBe(false);
    });

    it('creates the standard category when the table has none', async () => {
        const { dataSource, calls } = mockDataSource((sql) => {
            if (sql.includes('INSERT INTO')) return { insertId: 42 };
            return [];
        });

        await expect(resolveVisitCategoryId(dataSource)).resolves.toBe(42);
        expect(
            calls.some((c) =>
                c.sql.includes('INSERT INTO openemr_postcalendar_categories'),
            ),
        ).toBe(true);
    });

    it('never returns an id without having verified it exists', async () => {
        // Every path either matched a row or inserted one, so the value cannot be a
        // dangling reference.
        const { dataSource, calls } = mockDataSource((sql) => {
            if (sql.includes('INSERT INTO')) return { insertId: 7 };
            return [];
        });

        const id = await resolveVisitCategoryId(dataSource, 999);
        expect(id).toBe(7);
        expect(calls.filter((c) => c.sql.includes('INSERT INTO')).length).toBe(
            1,
        );
    });
});
