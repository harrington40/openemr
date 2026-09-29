import {
    Injectable,
    Logger,
    OnModuleInit,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LAB_CATALOG_SEED, UNMATCHED_SHEET_CODES } from './lab-catalog.data';

/** A `lab_test_catalog` row. */
export interface LabTestCatalogRow {
    id: number;
    code: string;
    name: string;
    category: string;
    unit: string | null;
    ref_min: number | string | null;
    ref_max: number | string | null;
    ref_text: string | null;
    result_type: string | null;
    options: string | null;
    display_order: number | null;
    active: number;
    sheet: string | null;
}

/** Payload accepted by `updateCatalogTest()`. */
export interface LabCatalogUpdateDto {
    [key: string]: unknown;
    refMin?: number | string | null;
    refMax?: number | string | null;
    refText?: string | null;
    unit?: string | null;
    name?: string;
    resultType?: string;
    options?: string | null;
    active?: boolean | number;
}

/** `procedure_order` row joined to patient demographics. */
export interface LabOrderFormRow {
    orderId: number;
    pid: number;
    instructions: string | null;
    orderStatus: string;
    dateOrdered: string;
    fname: string | null;
    lname: string | null;
    DOB: string | null;
    sex: string | null;
    public_id: string | null;
}

/** `procedure_result` row used to prefill the result form. */
export interface ProcedureResultPrefillRow {
    result_code: string;
    result_text: string | null;
    result: string | null;
    units: string | null;
    ref_range: string | null;
}

/** Result of an INSERT / UPDATE / DELETE. */
interface AffectedRowsResult {
    affectedRows: number;
    insertId: number;
}

/** `lab_result_reports` row. */
interface LabReportRow {
    id: number;
    pid: number;
    patient_id: number | null;
    lab_order_id: number | null;
    lab_no: string | null;
    status: string;
    technician_id: number | null;
    technician_name: string | null;
    verified_at: string | null;
    created_at: string;
}

/** A report row joined to its patient demographics. */
export interface LabReportView extends LabReportRow {
    fname: string | null;
    lname: string | null;
    DOB: string | null;
    sex: string | null;
    public_id: string | null;
    item_count?: number | string;
}

/** `lab_result_items` row. */
export interface LabResultItemRow {
    id: number;
    report_id: number;
    test_id: number | null;
    code: string | null;
    name: string;
    category: string | null;
    unit: string | null;
    result_value: string | null;
    ref_min: number | string | null;
    ref_max: number | string | null;
    ref_text: string | null;
    flag: string | null;
    comments: string | null;
    display_order: number | null;
}

/** One result item inside a report payload. */
interface LabResultItemDto {
    testId?: number | string | null;
    test_id?: number | string | null;
    code?: string | null;
    testCode?: string | null;
    name?: string | null;
    testName?: string | null;
    category?: string | null;
    unit?: string | null;
    resultType?: string | null;
    resultValue?: string | number | null;
    result_value?: string | number | null;
    refMin?: number | string | null;
    ref_min?: number | string | null;
    refMax?: number | string | null;
    ref_max?: number | string | null;
    refText?: string | null;
    ref_text?: string | null;
    flag?: string | null;
    comments?: string | null;
}

/** Payload accepted by `createReport()` / `updateReport()`. */
export interface LabReportDto {
    labNo?: string | null;
    items?: LabResultItemDto[];
    status?: string;
    labOrderId?: number | string | null;
    technicianId?: number | string | null;
    technicianName?: string | null;
    [key: string]: unknown;
}

/** Payload accepted by `verifyReport()`. */
export interface VerifyReportDto {
    technicianName?: string | null;
    technicianId?: number | null;
    [key: string]: unknown;
}

@Injectable()
export class LabReportsService implements OnModuleInit {
    private readonly logger = new Logger(LabReportsService.name);

    constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

    async onModuleInit(): Promise<void> {
        await this.ensureSchema();
        await this.seedCatalog();
        if (UNMATCHED_SHEET_CODES.length) {
            this.logger.error(
                `Lab catalog: ${UNMATCHED_SHEET_CODES.length} result-sheet code(s) do not exist and were dropped from the result form: ${UNMATCHED_SHEET_CODES.join(', ')}`,
            );
        }
    }

    private async ensureSchema(): Promise<void> {
        await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS lab_test_catalog (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(40) NOT NULL,
        name VARCHAR(120) NOT NULL,
        category VARCHAR(60) NOT NULL,
        unit VARCHAR(30) NULL,
        ref_min DECIMAL(10,3) NULL,
        ref_max DECIMAL(10,3) NULL,
        ref_text VARCHAR(120) NULL,
        result_type VARCHAR(20) NOT NULL DEFAULT 'NUMERIC',
        options VARCHAR(255) NULL,
        display_order INT NOT NULL DEFAULT 0,
        active TINYINT(1) NOT NULL DEFAULT 1,
        UNIQUE KEY uq_labtest_code (code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
        await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS lab_result_reports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pid INT NOT NULL,
        patient_id INT NULL,
        lab_order_id INT NULL,
        lab_no VARCHAR(40) NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
        technician_id INT NULL,
        technician_name VARCHAR(120) NULL,
        verified_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_labreport_pid (pid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
        await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS lab_result_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        report_id INT NOT NULL,
        test_id INT NULL,
        code VARCHAR(40) NULL,
        name VARCHAR(120) NOT NULL,
        category VARCHAR(60) NULL,
        unit VARCHAR(30) NULL,
        result_value VARCHAR(255) NULL,
        ref_min DECIMAL(10,3) NULL,
        ref_max DECIMAL(10,3) NULL,
        ref_text VARCHAR(120) NULL,
        flag VARCHAR(12) NULL,
        comments VARCHAR(255) NULL,
        display_order INT NOT NULL DEFAULT 0,
        INDEX idx_labitem_report (report_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
        await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS lab_result_audit (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NULL,
        patient_id INT NULL,
        lab_order_id INT NULL,
        report_id INT NULL,
        action VARCHAR(60) NULL,
        previous_value TEXT NULL,
        new_value TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
        // Which printed RESULT sheet(s) a test appears on. Added after the original
        // table, so it has to be applied to existing installs too; MariaDB supports
        // ADD COLUMN IF NOT EXISTS, making this safe to run on every boot.
        try {
            await this.dataSource.query(
                `ALTER TABLE lab_test_catalog ADD COLUMN IF NOT EXISTS sheet VARCHAR(255) NULL`,
            );
        } catch {
            // Older MySQL without IF NOT EXISTS: ignore "duplicate column" and carry on.
        }
        this.logger.log('Lab reports schema ready');
    }

    /**
     * Import the catalog from `LAB_CATALOG_SEED`.
     *
     * This used to DELETE every row that was not in the seed and then overwrite
     * `ref_min` / `ref_max` / `ref_text` on every boot. That is how the reference
     * ranges kept disappearing: any range that was not baked into the TypeScript
     * seed — including anything entered against the running system — was silently
     * wiped on the next restart or deploy.
     *
     * It is now additive: new seed rows are inserted, and existing rows only have
     * their *structural* fields refreshed (name, category, unit, result type,
     * options, display order, active). Reference ranges are written only when the
     * row is new or has no range at all, so a range set in this file, or edited
     * in-app, survives restarts. Rows are never deleted.
     */
    private async seedCatalog(): Promise<void> {
        // 1. Drop only the stale rows created by the deprecated seed — i.e. rows
        //    whose code matches the old MJ-nnn shape but is no longer in the seed.
        //    Rows with other codes are left alone so nothing bespoke is destroyed.
        const codes = LAB_CATALOG_SEED.map((t) => t.code);
        if (codes.length > 0) {
            const placeholders = codes.map(() => '?').join(', ');
            await this.dataSource.query(
                `DELETE FROM lab_test_catalog
          WHERE code REGEXP '^MJ-[0-9]{3}$' AND code NOT IN (${placeholders})`,
                codes,
            );
        }

        // 2. Insert missing rows, refresh structural fields on the rest.
        //
        //    The ref_* assignments come BEFORE `name = VALUES(name)` on purpose:
        //    MySQL evaluates ON DUPLICATE KEY UPDATE left to right, so referencing
        //    `name` here still yields the *stored* name and we can tell whether this
        //    code still refers to the same test.
        //      - same test  -> COALESCE keeps any range already stored/edited
        //      - name changed (the code now means a different test) -> take the
        //        seed's range, so a stale range cannot be left on the row
        for (const t of LAB_CATALOG_SEED) {
            await this.dataSource.query(
                `INSERT INTO lab_test_catalog
          (code, name, category, unit, ref_min, ref_max, ref_text, result_type, options, display_order, active, sheet)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE
           ref_min = IF(name <> VALUES(name), VALUES(ref_min), COALESCE(ref_min, VALUES(ref_min))),
           ref_max = IF(name <> VALUES(name), VALUES(ref_max), COALESCE(ref_max, VALUES(ref_max))),
           ref_text = IF(name <> VALUES(name), VALUES(ref_text),
                         COALESCE(NULLIF(ref_text, ''), VALUES(ref_text))),
           name = VALUES(name), category = VALUES(category),
           unit = COALESCE(VALUES(unit), unit),
           result_type = VALUES(result_type), options = VALUES(options),
           display_order = VALUES(display_order),
           active = 1,
           sheet = VALUES(sheet)`,
                [
                    t.code,
                    t.name,
                    t.category,
                    t.unit || null,
                    t.refMin ?? null,
                    t.refMax ?? null,
                    t.refText || null,
                    t.resultType,
                    t.options || null,
                    t.displayOrder,
                    t.sheet || null,
                ],
            );
        }
        this.logger.log(
            `Lab test catalog seeded (${LAB_CATALOG_SEED.length} tests)`,
        );
    }

    async getCatalog(category?: string): Promise<LabTestCatalogRow[]> {
        // IMPORTANT: order by the explicit global display_order ONLY. Category must
        // never drive sorting, otherwise the MJ-MC form order would be altered.
        const rows = category
            ? await this.dataSource.query<LabTestCatalogRow[]>(
                  `SELECT * FROM lab_test_catalog WHERE active = 1 AND category = ? ORDER BY display_order ASC, id ASC`,
                  [category],
              )
            : await this.dataSource.query<LabTestCatalogRow[]>(
                  `SELECT * FROM lab_test_catalog WHERE active = 1 ORDER BY display_order ASC, id ASC`,
              );
        return rows;
    }

    /**
     * Edit a catalog test in place — used to maintain the "Normal Value" range
     * shown on the result form. Only the fields present in the body are touched,
     * and an explicit `null` clears a bound (so a range can be removed).
     */
    async updateCatalogTest(
        id: number,
        dto: LabCatalogUpdateDto,
    ): Promise<LabTestCatalogRow> {
        const [existing] = await this.dataSource.query<{ id: number }[]>(
            `SELECT id FROM lab_test_catalog WHERE id = ?`,
            [id],
        );
        if (!existing) throw new NotFoundException(`Lab test ${id} not found`);

        const sets: string[] = [];
        const params: unknown[] = [];

        const numeric = (v: unknown): number | null => {
            if (v === null || v === undefined || v === '') return null;
            const n = Number(v);
            if (Number.isNaN(n))
                throw new BadRequestException(
                    `"${
                        typeof v === 'string' || typeof v === 'number'
                            ? v
                            : 'value'
                    }" is not a number`,
                );
            return n;
        };

        if ('refMin' in dto) {
            sets.push('ref_min = ?');
            params.push(numeric(dto.refMin));
        }
        if ('refMax' in dto) {
            sets.push('ref_max = ?');
            params.push(numeric(dto.refMax));
        }
        if ('refText' in dto) {
            sets.push('ref_text = ?');
            params.push(dto.refText ? String(dto.refText).slice(0, 120) : null);
        }
        if ('unit' in dto) {
            sets.push('unit = ?');
            params.push(dto.unit || null);
        }
        if ('name' in dto) {
            sets.push('name = ?');
            params.push(dto.name ? String(dto.name).slice(0, 120) : '');
        }
        if ('resultType' in dto) {
            sets.push('result_type = ?');
            params.push(dto.resultType);
        }
        if ('options' in dto) {
            sets.push('options = ?');
            params.push(dto.options || null);
        }
        if ('active' in dto) {
            sets.push('active = ?');
            params.push(dto.active ? 1 : 0);
        }

        if (!sets.length)
            throw new BadRequestException('No updatable fields supplied');

        // A min above a max is almost always a slip and would flag everything HIGH.
        const [current] = await this.dataSource.query<
            {
                ref_min: number | string | null;
                ref_max: number | string | null;
            }[]
        >(`SELECT ref_min, ref_max FROM lab_test_catalog WHERE id = ?`, [id]);
        const min = 'refMin' in dto ? numeric(dto.refMin) : current?.ref_min;
        const max = 'refMax' in dto ? numeric(dto.refMax) : current?.ref_max;
        if (min != null && max != null && Number(min) > Number(max)) {
            throw new BadRequestException(
                'Reference minimum cannot be greater than the maximum',
            );
        }

        params.push(id);
        await this.dataSource.query(
            `UPDATE lab_test_catalog SET ${sets.join(', ')} WHERE id = ?`,
            params,
        );
        const [row] = await this.dataSource.query<LabTestCatalogRow[]>(
            `SELECT * FROM lab_test_catalog WHERE id = ?`,
            [id],
        );
        this.logger.log(`Lab test ${id} updated (${sets.length} field(s))`);
        return row;
    }

    /**
     * Context for the result form when it is rendered inline for one lab order:
     * the patient, the ordered test names and the report already linked to the
     * order (if any). Lets the same result form show "the same lab" without
     * leaving the lab order page.
     */
    async getOrderResultForm(orderId: number) {
        const [order] = await this.dataSource.query<LabOrderFormRow[]>(
            `SELECT po.procedure_order_id AS orderId, po.patient_id AS pid,
              po.patient_instructions AS instructions, po.order_status AS orderStatus,
              po.date_ordered AS dateOrdered,
              pd.fname, pd.lname, pd.DOB, pd.sex, pd.public_id
         FROM procedure_order po
         LEFT JOIN patient_data pd ON pd.pid = po.patient_id
        WHERE po.procedure_order_id = ? LIMIT 1`,
            [orderId],
        );
        if (!order)
            throw new NotFoundException(`Lab order #${orderId} not found`);

        const base = String(order.instructions || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

        // patient_instructions stores the request-form panel/category that was
        // ordered, not the individual tests. Expand it against the catalog (by
        // category, test name/code or result sheet) so the inline result form shows
        // the SAME test rows as the lab result form.
        const orderedTests = await this.expandTestNames(base);

        const [linked] = await this.dataSource.query<{ id: number }[]>(
            `SELECT id FROM lab_result_reports WHERE lab_order_id = ? ORDER BY id DESC LIMIT 1`,
            [orderId],
        );
        const report = linked ? await this.getReport(linked.id) : null;

        // Results recorded against the order itself (procedure_result). Used to
        // prefill the result form when no report has been linked to the order yet.
        const results = await this.dataSource.query<
            ProcedureResultPrefillRow[]
        >(
            `SELECT res.result_code, res.result_text, res.result, res.units,
              res.\`range\` AS ref_range
         FROM procedure_result res
         JOIN procedure_report pr ON pr.procedure_report_id = res.procedure_report_id
        WHERE pr.procedure_order_id = ?
        ORDER BY res.procedure_result_id`,
            [orderId],
        );

        return { order, orderedTests, report, results };
    }

    async getOrderedTestNames(pid: number): Promise<string[]> {
        const rows = await this.dataSource.query<{ testName: string | null }[]>(
            `SELECT DISTINCT patient_instructions AS testName
       FROM procedure_order
       WHERE patient_id = ? AND activity = 1
         AND order_status NOT IN ('cancelled','rejected','duplicate')
       ORDER BY date_ordered DESC`,
            [pid],
        );
        const names = rows
            .map((r) => String(r.testName || '').trim())
            .filter(Boolean);
        return this.expandTestNames(names);
    }

    /**
     * An order stores the request-form panel/category (or sheet) it was placed
     * for, not the individual tests. Expand those names to the catalog test names
     * they cover so the result form and the inline order result form show exactly
     * the same test rows.
     */
    private async expandTestNames(names: string[]): Promise<string[]> {
        const base = (names || []).map((s) => String(s).trim()).filter(Boolean);
        if (!base.length) return [];

        const catalogRows = await this.dataSource.query<
            {
                code: string;
                name: string;
                category: string | null;
                sheet: string | null;
            }[]
        >(
            `SELECT code, name, category, sheet FROM lab_test_catalog WHERE active = 1`,
        );
        const wanted = base.map((b) => b.toLowerCase());
        const expanded = catalogRows
            .filter((c) => {
                const cat = String(c.category || '').toLowerCase();
                const name = String(c.name || '').toLowerCase();
                const code = String(c.code || '').toLowerCase();
                const sheets = String(c.sheet || '')
                    .split(',')
                    .map((s) => s.trim().toLowerCase())
                    .filter(Boolean);
                return (
                    wanted.includes(cat) ||
                    wanted.includes(name) ||
                    wanted.includes(code) ||
                    sheets.some((s) => wanted.includes(s))
                );
            })
            .map((c) => String(c.name || '').trim())
            .filter(Boolean);

        return Array.from(new Set([...base, ...expanded]));
    }

    /** Coerce a possibly-string numeric field to a number (or null). */
    private toNumOrNull(v: unknown): number | null {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        return Number.isNaN(n) ? null : n;
    }

    /** Coerce a possibly-numeric field to text (or null). */
    private toTextOrNull(v: unknown): string | null {
        if (v === null || v === undefined || v === '') return null;
        return typeof v === 'string' || typeof v === 'number'
            ? String(v)
            : null;
    }

    private computeFlag(
        resultType: string,
        value: string | null,
        refMin: number | null,
        refMax: number | null,
    ): string | null {
        if (value == null || value === '') return null;
        if (resultType === 'NUMERIC' && (refMin != null || refMax != null)) {
            const num = Number(value);
            if (isNaN(num)) return 'TEXT';
            if (refMin != null && num < refMin) return 'LOW';
            if (refMax != null && num > refMax) return 'HIGH';
            return 'NORMAL';
        }
        if (resultType === 'POSITIVE_NEGATIVE') {
            const v = value.toLowerCase();
            if (['negative', 'non-reactive', 'non reactive'].includes(v))
                return 'NEGATIVE';
            if (['positive', 'reactive'].includes(v)) return 'POSITIVE';
            return 'TEXT';
        }
        return null;
    }

    async createReport(
        pid: number,
        dto: LabReportDto,
    ): Promise<{ id: number; labNo: string }> {
        const [patient] = await this.dataSource.query<
            { pid: number; id: number }[]
        >(`SELECT pid, id FROM patient_data WHERE pid = ? LIMIT 1`, [pid]);
        if (!patient) throw new NotFoundException(`Patient #${pid} not found`);

        const [last] = await this.dataSource.query<
            { nextId: number | string }[]
        >(`SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM lab_result_reports`);
        const labNo =
            dto.labNo ||
            `MAJ-${new Date().getFullYear()}-${String(last?.nextId || 1).padStart(5, '0')}`;

        const items = Array.isArray(dto.items) ? dto.items : [];
        const status = dto.status === 'VERIFIED' ? 'VERIFIED' : 'DRAFT';

        const ins = await this.dataSource.query<AffectedRowsResult>(
            `INSERT INTO lab_result_reports
        (pid, patient_id, lab_order_id, lab_no, status, technician_id, technician_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                pid,
                patient.id,
                dto.labOrderId || null,
                labNo,
                status,
                dto.technicianId || null,
                dto.technicianName || null,
            ],
        );
        const reportId = ins.insertId;

        await this.saveItems(reportId, items);

        // Results entered on the lab result form for a lab order must also reach the
        // order (procedure_result), so the chart and validate/refer workflow work.
        if (dto.labOrderId) {
            await this.syncOrderResults(Number(dto.labOrderId), items);
        }

        await this.audit(
            null,
            pid,
            Number(dto.labOrderId) || null,
            reportId,
            'CREATE',
            null,
            `Report ${labNo} created (${status})`,
        );

        if (status === 'VERIFIED') {
            await this.dataSource.query(
                `UPDATE lab_result_reports SET verified_at = NOW() WHERE id = ?`,
                [reportId],
            );
        }

        return { id: reportId, labNo };
    }

    private async saveItems(
        reportId: number,
        items: LabResultItemDto[],
    ): Promise<void> {
        for (let i = 0; i < items.length; i++) {
            const it = items[i] || {};
            if (!it || (!it.testId && !it.code && !it.name)) continue;
            const flag = this.computeFlag(
                it.resultType || 'NUMERIC',
                this.toTextOrNull(it.resultValue ?? it.result_value),
                this.toNumOrNull(it.refMin ?? it.ref_min),
                this.toNumOrNull(it.refMax ?? it.ref_max),
            );
            await this.dataSource.query(
                `INSERT INTO lab_result_items
          (report_id, test_id, code, name, category, unit, result_value,
           ref_min, ref_max, ref_text, flag, comments, display_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    reportId,
                    it.testId ?? it.test_id ?? null,
                    it.code || null,
                    it.name || it.testName || 'Test',
                    it.category || null,
                    it.unit || null,
                    it.resultValue ?? it.result_value ?? '',
                    it.refMin ?? it.ref_min ?? null,
                    it.refMax ?? it.ref_max ?? null,
                    it.refText ?? it.ref_text ?? null,
                    it.flag ?? flag,
                    it.comments || null,
                    i,
                ],
            );
        }
    }

    async updateReport(
        id: number,
        dto: LabReportDto,
        userId: number | null,
    ): Promise<{ id: number; status: string }> {
        const [report] = await this.dataSource.query<LabReportRow[]>(
            `SELECT * FROM lab_result_reports WHERE id = ? LIMIT 1`,
            [id],
        );
        if (!report) throw new NotFoundException(`Report #${id} not found`);

        const prev = await this.getReportItems(id);
        await this.dataSource.query(
            `DELETE FROM lab_result_items WHERE report_id = ?`,
            [id],
        );

        const items = Array.isArray(dto.items) ? dto.items : [];
        await this.saveItems(id, items);
        if (report.lab_order_id) {
            await this.syncOrderResults(Number(report.lab_order_id), items);
        }
        await this.audit(
            userId,
            report.pid,
            report.lab_order_id,
            id,
            'UPDATE',
            JSON.stringify(prev),
            JSON.stringify(items),
        );

        return { id, status: report.status };
    }

    /**
     * Mirror a report's items into the order's procedure_result rows and mark the
     * order completed, so results entered on the (embedded) lab result form flow
     * to the patient chart and the validate/refer workflow exactly as before.
     */
    private async syncOrderResults(
        orderId: number,
        items: LabResultItemDto[],
    ): Promise<void> {
        try {
            const [order] = await this.dataSource.query<
                { procedure_order_id: number }[]
            >(
                `SELECT procedure_order_id FROM procedure_order WHERE procedure_order_id = ? LIMIT 1`,
                [orderId],
            );
            if (!order) return;

            const [report] = await this.dataSource.query<
                { procedure_report_id: number }[]
            >(
                `SELECT procedure_report_id FROM procedure_report WHERE procedure_order_id = ? LIMIT 1`,
                [orderId],
            );
            let reportId: number;
            if (!report) {
                const r = await this.dataSource.query<AffectedRowsResult>(
                    `INSERT INTO procedure_report (procedure_order_id, date_report, report_status, review_status)
           VALUES (?, NOW(), 'final', 'reviewed')`,
                    [orderId],
                );
                reportId = r.insertId;
            } else {
                reportId = report.procedure_report_id;
            }

            await this.dataSource.query(
                `DELETE FROM procedure_result WHERE procedure_report_id = ?`,
                [reportId],
            );

            for (const it of items || []) {
                const value = String(
                    it?.resultValue ?? it?.result_value ?? '',
                ).trim();
                if (!value) continue; // never file empty rows
                const flag = this.computeFlag(
                    it?.resultType || 'NUMERIC',
                    value,
                    this.toNumOrNull(it?.refMin ?? it?.ref_min),
                    this.toNumOrNull(it?.refMax ?? it?.ref_max),
                );
                await this.dataSource.query(
                    `INSERT INTO procedure_result
             (procedure_report_id, result_code, result_text, result, units, \`range\`, abnormal, comments, date, result_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'final')`,
                    [
                        reportId,
                        it?.code || it?.testCode || '',
                        it?.name || it?.testName || '',
                        value,
                        it?.unit || '',
                        it?.refText || it?.ref_text || '',
                        flag || 'N',
                        it?.comments || '',
                    ],
                );
            }

            await this.dataSource.query(
                `UPDATE procedure_order SET order_status = 'completed'
          WHERE procedure_order_id = ? AND order_status NOT IN ('validated','rejected','cancelled')`,
                [orderId],
            );
        } catch (e) {
            this.logger.warn(
                `Could not sync order #${orderId} results into procedure_result: ${e}`,
            );
        }
    }

    async verifyReport(
        id: number,
        dto: VerifyReportDto,
        userId: number | null,
    ): Promise<{ id: number; status: string }> {
        const [report] = await this.dataSource.query<LabReportRow[]>(
            `SELECT * FROM lab_result_reports WHERE id = ? LIMIT 1`,
            [id],
        );
        if (!report) throw new NotFoundException(`Report #${id} not found`);

        const technicianName =
            dto?.technicianName || report.technician_name || null;
        await this.dataSource.query(
            `UPDATE lab_result_reports SET status = 'VERIFIED', verified_at = NOW(),
         technician_id = ?, technician_name = ? WHERE id = ?`,
            [
                dto?.technicianId ?? report.technician_id ?? userId,
                technicianName,
                id,
            ],
        );
        await this.audit(
            userId,
            report.pid,
            report.lab_order_id,
            id,
            'VERIFY',
            report.status,
            'VERIFIED',
        );
        return { id, status: 'VERIFIED' };
    }

    async getReports(pid: number): Promise<LabReportView[]> {
        const rows = await this.dataSource.query<LabReportView[]>(
            `SELECT r.*, pd.fname, pd.lname, pd.DOB, pd.sex, pd.public_id,
              (SELECT COUNT(*) FROM lab_result_items i WHERE i.report_id = r.id) AS item_count
       FROM lab_result_reports r
       LEFT JOIN patient_data pd ON pd.pid = r.pid
       WHERE r.pid = ?
       ORDER BY r.created_at DESC, r.id DESC`,
            [pid],
        );
        return rows;
    }

    async getReportItems(id: number): Promise<LabResultItemRow[]> {
        return this.dataSource.query<LabResultItemRow[]>(
            `SELECT * FROM lab_result_items WHERE report_id = ? ORDER BY display_order ASC`,
            [id],
        );
    }

    async getReport(
        id: number,
    ): Promise<LabReportView & { items: LabResultItemRow[] }> {
        const [report] = await this.dataSource.query<LabReportView[]>(
            `SELECT r.*, pd.fname, pd.lname, pd.DOB, pd.sex, pd.public_id, pd.id AS patient_id
       FROM lab_result_reports r
       LEFT JOIN patient_data pd ON pd.pid = r.pid
       WHERE r.id = ? LIMIT 1`,
            [id],
        );
        if (!report) throw new NotFoundException(`Report #${id} not found`);
        const items = await this.getReportItems(id);
        return { ...report, items };
    }

    private async audit(
        userId: number | null,
        patientId: number | null,
        labOrderId: number | null,
        reportId: number | null,
        action: string,
        previousValue: string | null,
        newValue: string | null,
    ): Promise<void> {
        await this.dataSource.query(
            `INSERT INTO lab_result_audit (user_id, patient_id, lab_order_id, report_id, action, previous_value, new_value)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                patientId,
                labOrderId,
                reportId,
                action,
                previousValue,
                newValue,
            ],
        );
    }
}
