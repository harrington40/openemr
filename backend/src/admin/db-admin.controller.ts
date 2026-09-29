import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

/** `information_schema.TABLES` row. */
interface InfoSchemaTableRow {
    TABLE_NAME: string;
    TABLE_ROWS: number | null;
    TABLE_COMMENT: string;
}

/** `information_schema.COLUMNS` row. */
interface InfoSchemaColumnRow {
    COLUMN_NAME: string;
    COLUMN_TYPE: string;
    IS_NULLABLE: string;
    COLUMN_DEFAULT: string | null;
    COLUMN_KEY: string;
    EXTRA: string;
}

/** Any arbitrary row returned by an ad-hoc browse/query. */
type UnknownRow = Record<string, unknown>;

@Controller('db-admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class DbAdminController {
    constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

    @Get('tables')
    async listTables() {
        const rows = await this.dataSource.query<InfoSchemaTableRow[]>(
            `SELECT TABLE_NAME, TABLE_ROWS, TABLE_COMMENT
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
       ORDER BY TABLE_NAME`,
        );
        return rows.map((r) => ({
            name: r.TABLE_NAME,
            rows: r.TABLE_ROWS || 0,
            comment: r.TABLE_COMMENT || '',
        }));
    }

    @Get('describe/:table')
    async describeTable(@Param('table') table: string) {
        const columns = await this.dataSource.query<InfoSchemaColumnRow[]>(
            `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
            [table],
        );
        return columns;
    }

    @Get('browse/:table')
    async browseTable(@Param('table') table: string) {
        const rows = await this.dataSource.query<UnknownRow[]>(
            `SELECT * FROM \`${table}\` ORDER BY 1 DESC LIMIT 100`,
        );
        return rows;
    }

    @Post('query')
    async runQuery(@Body('sql') sql: string) {
        if (!sql) return { error: 'SQL query is required' };
        // Safety: only SELECT queries
        const trimmed = sql.trim().toUpperCase();
        if (
            !trimmed.startsWith('SELECT') &&
            !trimmed.startsWith('SHOW') &&
            !trimmed.startsWith('DESCRIBE')
        ) {
            return {
                error: 'Only SELECT, SHOW, and DESCRIBE queries are allowed',
            };
        }
        try {
            const rows = await this.dataSource.query<UnknownRow[]>(sql);
            return { rows, count: Array.isArray(rows) ? rows.length : 0 };
        } catch (err) {
            return {
                error: err instanceof Error ? err.message : 'Query failed',
            };
        }
    }
}
