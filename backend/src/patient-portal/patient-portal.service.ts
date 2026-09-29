import {
    Injectable,
    Logger,
    OnModuleInit,
    BadRequestException,
    UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { generatePassword, validatePassword } from './password-policy.util';

/**
 * bcrypt cost for portal credentials.
 *
 * One step above the 10 used for staff accounts. Portal login is reachable
 * without a staff session, so the hash is the only thing between an attacker
 * holding a copy of the database and a patient's records. Cost 12 costs roughly
 * four times the CPU of 10 — negligible at a clinic's login volume, and the
 * lockout below bounds how often an anonymous caller can make us do the work.
 */
const BCRYPT_COST = 12;

/** Failed attempts allowed before the account is temporarily frozen. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

/**
 * A hash of a value no password will match, used to spend the same CPU on an
 * unknown account as on a known one, so response time does not reveal whether
 * a particular Patient ID has an account.
 */
const DUMMY_HASH = bcrypt.hashSync(
    'not-a-real-password-placeholder',
    BCRYPT_COST,
);

export interface IssuedPassword {
    /** Shown once, at issue. Never stored and never retrievable again. */
    password: string;
}

export interface PasswordState {
    mustChange: boolean;
    lockedUntil: Date | null;
    failedAttempts: number;
}

/** `must_change_password` flag row. */
interface CredentialFlagRow {
    must_change_password: number;
}

/** Credential state row. */
interface CredentialStateRow {
    must_change_password: number;
    failed_attempts: number;
    locked_until: string | Date | null;
}

/** Credential verification row. */
interface CredentialVerifyRow {
    password_hash: string;
    failed_attempts: number;
    locked_until: string | Date | null;
}

/** Row holding only the stored password hash. */
interface CredentialHashRow {
    password_hash: string;
}

@Injectable()
export class PatientPortalService implements OnModuleInit {
    private readonly logger = new Logger(PatientPortalService.name);

    constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

    async onModuleInit(): Promise<void> {
        await this.ensureSchema();
    }

    private async ensureSchema(): Promise<void> {
        await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS patient_portal_credentials (
        pid INT NOT NULL PRIMARY KEY,
        password_hash VARCHAR(255) NOT NULL,
        must_change_password TINYINT(1) NOT NULL DEFAULT 1,
        failed_attempts INT NOT NULL DEFAULT 0,
        locked_until DATETIME NULL,
        password_changed_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_portal_locked (locked_until)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
        this.logger.log('patient_portal_credentials schema ready');
    }

    async hash(password: string): Promise<string> {
        return bcrypt.hash(password, BCRYPT_COST);
    }

    /**
     * Creates or replaces a patient's portal password and returns the plaintext
     * exactly once, for the desk to hand over. That single return is the point:
     * the password is never recoverable from the database afterwards.
     *
     * `mustChange` defaults to true — a password the patient did not choose is a
     * credential for one login, not a lasting one.
     */
    async issuePassword(
        pid: number,
        options: { password?: string; mustChange?: boolean } = {},
    ): Promise<IssuedPassword> {
        if (!pid || Number.isNaN(Number(pid))) {
            throw new BadRequestException(
                'A patient is required to issue portal credentials',
            );
        }

        let password = options.password;
        if (password === undefined) {
            password = generatePassword();
        } else {
            // A caller-supplied password clears the same bar as one the patient sets,
            // otherwise the policy is bypassable at issue time.
            const check = validatePassword(password);
            if (!check.ok) {
                throw new BadRequestException({
                    message: 'Password does not meet the policy',
                    problems: check.problems,
                });
            }
        }

        const hash = await this.hash(password);
        const mustChange = options.mustChange === false ? 0 : 1;

        await this.dataSource.query(
            `INSERT INTO patient_portal_credentials
         (pid, password_hash, must_change_password, failed_attempts, locked_until, password_changed_at)
       VALUES (?, ?, ?, 0, NULL, NULL)
       ON DUPLICATE KEY UPDATE
         password_hash = VALUES(password_hash),
         must_change_password = VALUES(must_change_password),
         failed_attempts = 0,
         locked_until = NULL,
         password_changed_at = NULL`,
            [pid, hash, mustChange],
        );

        return { password };
    }

    /** True when the patient still has to replace a password they did not choose. */
    async mustChangePassword(pid: number): Promise<boolean> {
        const rows = await this.dataSource.query<CredentialFlagRow[]>(
            'SELECT must_change_password FROM patient_portal_credentials WHERE pid = ? LIMIT 1',
            [pid],
        );
        return rows.length ? rows[0].must_change_password === 1 : false;
    }

    async state(pid: number): Promise<PasswordState | null> {
        const rows = await this.dataSource.query<CredentialStateRow[]>(
            `SELECT must_change_password, failed_attempts, locked_until
       FROM patient_portal_credentials WHERE pid = ? LIMIT 1`,
            [pid],
        );
        if (!rows.length) return null;
        return {
            mustChange: rows[0].must_change_password === 1,
            failedAttempts: rows[0].failed_attempts,
            lockedUntil: rows[0].locked_until
                ? new Date(rows[0].locked_until)
                : null,
        };
    }

    /**
     * Checks a password for a patient.
     *
     * Returns a plain boolean and keeps the reason private — the caller reports
     * one generic failure either way, so an anonymous attacker cannot use the
     * response to learn whether an account exists or is currently locked.
     */
    async verify(pid: number, password: string): Promise<boolean> {
        const rows = await this.dataSource.query<CredentialVerifyRow[]>(
            `SELECT password_hash, failed_attempts, locked_until
       FROM patient_portal_credentials WHERE pid = ? LIMIT 1`,
            [pid],
        );

        if (!rows.length) {
            // No portal credentials for this patient. Burn the same CPU so response
            // time does not reveal that this Patient ID has no account.
            bcrypt.compareSync(password, DUMMY_HASH);
            return false;
        }

        const row = rows[0];
        if (
            row.locked_until &&
            new Date(row.locked_until).getTime() > Date.now()
        ) {
            return false;
        }

        const valid = bcrypt.compareSync(password, row.password_hash);

        if (valid) {
            // Clear the counter and expire any stale lock.
            await this.dataSource.query(
                'UPDATE patient_portal_credentials SET failed_attempts = 0, locked_until = NULL WHERE pid = ?',
                [pid],
            );
            return true;
        }

        const attempts = Number(row.failed_attempts || 0) + 1;
        if (attempts >= MAX_FAILED_ATTEMPTS) {
            // Freeze the account rather than allowing unlimited guessing. The counter
            // stays at the threshold so any further failure re-arms the lock.
            await this.dataSource.query(
                `UPDATE patient_portal_credentials
         SET failed_attempts = ?, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE)
         WHERE pid = ?`,
                [attempts, LOCKOUT_MINUTES, pid],
            );
            this.logger.warn(
                `Portal account for pid ${pid} locked after ${attempts} failed attempts`,
            );
        } else {
            await this.dataSource.query(
                'UPDATE patient_portal_credentials SET failed_attempts = ? WHERE pid = ?',
                [attempts, pid],
            );
        }

        return false;
    }

    /**
     * Replaces a password after the patient proves they know the current one.
     *
     * The current password is required even though the caller already holds a
     * valid portal token: a token can be left behind on an unlocked workstation,
     * and without this check that alone would be enough to take the account over.
     */
    async changePassword(
        pid: number,
        currentPassword: string,
        newPassword: string,
    ): Promise<void> {
        if (!currentPassword || !newPassword) {
            throw new BadRequestException(
                'Current and new password are both required',
            );
        }
        if (currentPassword === newPassword) {
            throw new BadRequestException(
                'The new password must be different from the current one',
            );
        }

        const check = validatePassword(newPassword);
        if (!check.ok) {
            throw new BadRequestException({
                message: 'Password does not meet the policy',
                problems: check.problems,
            });
        }

        const rows = await this.dataSource.query<CredentialHashRow[]>(
            'SELECT password_hash FROM patient_portal_credentials WHERE pid = ? LIMIT 1',
            [pid],
        );
        if (!rows.length) {
            throw new UnauthorizedException(
                'No portal account found for this patient',
            );
        }

        // Compare against the stored hash directly rather than via verify(), so a
        // successful change neither depends on nor disturbs the lockout counter.
        if (!bcrypt.compareSync(currentPassword, rows[0].password_hash)) {
            throw new UnauthorizedException(
                'The current password is not correct',
            );
        }

        const hash = await this.hash(newPassword);
        await this.dataSource.query(
            `UPDATE patient_portal_credentials
       SET password_hash = ?, must_change_password = 0, failed_attempts = 0,
           locked_until = NULL, password_changed_at = NOW()
       WHERE pid = ?`,
            [hash, pid],
        );

        this.logger.log(`Portal password changed by pid ${pid}`);
    }
}
