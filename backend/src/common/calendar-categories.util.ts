/**
 * The only part of a `DataSource` this helper uses. Declaring the narrow shape
 * keeps the dependency (and the test double) honest.
 */
export interface CategoryDataSource {
    query<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
}

/** Row holding an existing calendar-category id. */
interface CalendarCategoryIdRow {
    pc_catid: number;
}

/** Affected-rows result of the category insert. */
interface CalendarCategoryInsertResult {
    insertId: number;
}

/**
 * Calendar categories.
 *
 * `form_encounter.pc_catid` and `openemr_postcalendar_events.pc_catid` were both
 * written with a hardcoded 5. When that category row was deleted, every record
 * the app had filed pointed at a category that did not exist: encounters and
 * appointments showed no category, and anything filtering or colouring by
 * category silently dropped them. Resolve the id against the table instead.
 */

/** The category ordinary visits are filed under. */
export const DEFAULT_VISIT_CATEGORY = 'Office Visit';

/** pc_cattype 1 = patient appointment category; 2 = provider availability block. */
const APPOINTMENT_CATEGORY_TYPE = 1;

/**
 * Returns a category id that is guaranteed to exist.
 *
 * Uses `preferredId` when it is still present, otherwise falls back to any active
 * appointment category, then to the standard visit category, creating it only if
 * the table has nothing suitable at all.
 */
export async function resolveVisitCategoryId(
    dataSource: CategoryDataSource,
    preferredId?: number | string | null,
): Promise<number> {
    const preferred = Number(preferredId);
    if (Number.isFinite(preferred) && preferred > 0) {
        const rows = await dataSource.query<CalendarCategoryIdRow[]>(
            `SELECT pc_catid FROM openemr_postcalendar_categories WHERE pc_catid = ? LIMIT 1`,
            [preferred],
        );
        if (rows?.length) return Number(rows[0].pc_catid);
    }

    const existing = await dataSource.query<CalendarCategoryIdRow[]>(
        `SELECT pc_catid FROM openemr_postcalendar_categories
      WHERE pc_cattype = ? AND pc_active = 1
      ORDER BY pc_catid ASC LIMIT 1`,
        [APPOINTMENT_CATEGORY_TYPE],
    );
    if (existing?.length) return Number(existing[0].pc_catid);

    const byName = await dataSource.query<CalendarCategoryIdRow[]>(
        `SELECT pc_catid FROM openemr_postcalendar_categories WHERE pc_catname = ? LIMIT 1`,
        [DEFAULT_VISIT_CATEGORY],
    );
    if (byName?.length) return Number(byName[0].pc_catid);

    // Nothing usable in the table — add the standard visit category.
    const inserted = await dataSource.query<CalendarCategoryInsertResult>(
        `INSERT INTO openemr_postcalendar_categories
       (pc_constant_id, pc_catname, pc_catcolor, pc_catdesc, pc_recurrtype, pc_duration,
        pc_end_date_flag, pc_end_date_freq, pc_end_all_day, pc_dailylimit, pc_cattype,
        pc_active, pc_seq, aco_spec)
     VALUES (NULL, ?, '#17a2b8', 'General office visit', 0, 15, 0, 0, 0, 0, ?, 1, 0, 'encounters|notes')`,
        [DEFAULT_VISIT_CATEGORY, APPOINTMENT_CATEGORY_TYPE],
    );
    return Number(inserted.insertId);
}
