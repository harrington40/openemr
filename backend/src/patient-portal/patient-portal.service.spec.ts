import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PatientPortalService } from './patient-portal.service';

/**
 * A tiny in-memory stand-in for patient_portal_credentials.
 *
 * The service's real work is hashing, lockout arithmetic and policy
 * enforcement, so the fake answers the handful of statements it issues and
 * keeps state between them — that is what lets the lockout and change-password
 * flows be tested end to end rather than one call at a time.
 */
/** Row shape of the stand-in `patient_portal_credentials` table. */
interface CredentialRow {
    pid: number;
    password_hash: string;
    must_change_password: number;
    failed_attempts: number;
    locked_until: Date | null;
    password_changed_at: Date | null;
}

class FakeCredentialsTable {
    public rows = new Map<number, CredentialRow>();

    private one(pid: number): CredentialRow[] {
        return this.rows.has(pid) ? [this.rows.get(pid)!] : [];
    }

    query(
        sql: string,
        params: Array<number | string | Date | null> = [],
    ): Array<Partial<CredentialRow>> {
        const s = sql.replace(/\s+/g, ' ').trim();

        if (/^CREATE TABLE IF NOT EXISTS patient_portal_credentials/i.test(s))
            return [];

        if (/^INSERT INTO patient_portal_credentials/i.test(s)) {
            const [pid, hash, mustChange] = params;
            this.rows.set(Number(pid), {
                pid: Number(pid),
                password_hash: String(hash),
                must_change_password: Number(mustChange),
                failed_attempts: 0,
                locked_until: null,
                password_changed_at: null,
            });
            return [];
        }

        if (
            /SELECT must_change_password, failed_attempts, locked_until/i.test(
                s,
            )
        ) {
            const r = this.rows.get(Number(params[0]));
            return r
                ? [
                      {
                          must_change_password: r.must_change_password,
                          failed_attempts: r.failed_attempts,
                          locked_until: r.locked_until,
                      },
                  ]
                : [];
        }
        if (/SELECT must_change_password FROM/i.test(s)) {
            const r = this.rows.get(Number(params[0]));
            return r ? [{ must_change_password: r.must_change_password }] : [];
        }
        if (/SELECT password_hash, failed_attempts, locked_until/i.test(s)) {
            const r = this.rows.get(Number(params[0]));
            return r
                ? [
                      {
                          password_hash: r.password_hash,
                          failed_attempts: r.failed_attempts,
                          locked_until: r.locked_until,
                      },
                  ]
                : [];
        }
        if (/SELECT password_hash FROM/i.test(s)) {
            const r = this.rows.get(Number(params[0]));
            return r ? [{ password_hash: r.password_hash }] : [];
        }

        if (/locked_until = DATE_ADD\(NOW\(\), INTERVAL \? MINUTE\)/i.test(s)) {
            const [attempts, , pid] = params;
            const r = this.rows.get(Number(pid));
            if (r) {
                r.failed_attempts = Number(attempts);
                r.locked_until = new Date(Date.now() + 15 * 60 * 1000);
            }
            return [];
        }
        if (/SET failed_attempts = \d+, locked_until = NULL/i.test(s)) {
            const [pid] = params;
            const r = this.rows.get(Number(pid));
            if (r) {
                r.failed_attempts = 0;
                r.locked_until = null;
            }
            return [];
        }
        if (/SET password_hash = \?/i.test(s)) {
            const [hash, pid] = params;
            const r = this.rows.get(Number(pid));
            if (r) {
                r.password_hash = String(hash);
                r.must_change_password = 0;
                r.failed_attempts = 0;
                r.locked_until = null;
                r.password_changed_at = new Date();
            }
            return [];
        }
        if (/SET failed_attempts = \? WHERE pid = \?/i.test(s)) {
            const [attempts, pid] = params;
            const r = this.rows.get(Number(pid));
            if (r) r.failed_attempts = Number(attempts);
            return [];
        }

        throw new Error(`FakeCredentialsTable has no handler for: ${s}`);
    }
}

async function build() {
    const db = new FakeCredentialsTable();
    const module = await Test.createTestingModule({
        providers: [
            PatientPortalService,
            { provide: getDataSourceToken(), useValue: db },
        ],
    }).compile();
    const service = module.get(PatientPortalService);
    await service.onModuleInit();
    return { service, db };
}

/** A password that satisfies the policy, used as the "patient's own choice". */
const STRONG = 'Kav#7tremBle!x';

describe('PatientPortalService — issuing', () => {
    it('stores only a hash, never the password itself', async () => {
        const { service, db } = await build();
        const { password } = await service.issuePassword(42);

        const stored = db.rows.get(42)!;
        expect(stored.password_hash).not.toBe(password);
        expect(stored.password_hash).not.toContain(password);
        expect(stored.password_hash).toMatch(/^\$2[aby]\$/);
    });

    it('hashes at a cost above the staff default of 10', async () => {
        const { service, db } = await build();
        await service.issuePassword(42);
        // Format is $2b$<cost>$... — portal logins are unauthenticated, so the
        // offline-cracking cost is raised deliberately.
        expect(db.rows.get(42)!.password_hash).toMatch(/^\$2[aby]\$12\$/);
    });

    it('issues a password the service then accepts', async () => {
        const { service } = await build();
        const { password } = await service.issuePassword(42);
        expect(await service.verify(42, password)).toBe(true);
    });

    it('marks a freshly issued password as needing a change', async () => {
        const { service } = await build();
        await service.issuePassword(42);
        expect(await service.mustChangePassword(42)).toBe(true);
    });

    it('refuses a caller-supplied password that breaks the policy', async () => {
        // Otherwise the policy would be bypassable at issue time.
        const { service } = await build();
        await expect(
            service.issuePassword(42, { password: 'weak' }),
        ).rejects.toThrow(/policy/i);
    });

    it('accepts a caller-supplied password that meets the policy', async () => {
        const { service } = await build();
        await service.issuePassword(42, { password: STRONG });
        expect(await service.verify(42, STRONG)).toBe(true);
    });

    it('reissues by replacing the old password rather than adding a second', async () => {
        const { service, db } = await build();
        const first = await service.issuePassword(42);
        const second = await service.issuePassword(42);

        expect(db.rows.size).toBe(1);
        expect(await service.verify(42, second.password)).toBe(true);
        expect(await service.verify(42, first.password)).toBe(false);
    });
});

describe('PatientPortalService — verifying', () => {
    it('rejects the wrong password', async () => {
        const { service } = await build();
        await service.issuePassword(42, { password: STRONG });
        expect(await service.verify(42, `${STRONG}x`)).toBe(false);
    });

    it('returns false for a patient with no portal account, rather than throwing', async () => {
        // The controller turns this into the same generic message as a bad
        // password, so the caller cannot tell the account is missing.
        const { service } = await build();
        expect(await service.verify(99, STRONG)).toBe(false);
    });

    it('accepts the correct password after earlier failures', async () => {
        const { service, db } = await build();
        await service.issuePassword(42, { password: STRONG });
        await service.verify(42, 'wrong-one');
        await service.verify(42, 'wrong-two');
        expect(db.rows.get(42)!.failed_attempts).toBe(2);

        expect(await service.verify(42, STRONG)).toBe(true);
    }, 30000);

    it('clears the failure counter on a successful login', async () => {
        const { service, db } = await build();
        await service.issuePassword(42, { password: STRONG });
        await service.verify(42, 'wrong-one');
        await service.verify(42, STRONG);
        expect(db.rows.get(42)!.failed_attempts).toBe(0);
    }, 30000);

    it('counts each failure', async () => {
        const { service, db } = await build();
        await service.issuePassword(42, { password: STRONG });
        for (let i = 1; i <= 3; i++) {
            expect(await service.verify(42, 'nope')).toBe(false);
            expect(db.rows.get(42)!.failed_attempts).toBe(i);
        }
    }, 30000);

    it('locks the account after five failures', async () => {
        const { service, db } = await build();
        await service.issuePassword(42, { password: STRONG });
        for (let i = 0; i < 5; i++) await service.verify(42, 'nope');

        const row = db.rows.get(42)!;
        expect(row.failed_attempts).toBeGreaterThanOrEqual(5);
        expect(row.locked_until).toBeInstanceOf(Date);
        expect(row.locked_until!.getTime()).toBeGreaterThan(Date.now());
    }, 30000);

    it('refuses even the correct password while locked', async () => {
        // The point of the lock is that guessing stops being useful.
        const { service } = await build();
        await service.issuePassword(42, { password: STRONG });
        for (let i = 0; i < 5; i++) await service.verify(42, 'nope');

        expect(await service.verify(42, STRONG)).toBe(false);
    }, 30000);

    it('accepts the correct password once the lock has expired', async () => {
        const { service, db } = await build();
        await service.issuePassword(42, { password: STRONG });
        for (let i = 0; i < 5; i++) await service.verify(42, 'nope');

        // Stand in for the fifteen minutes passing.
        db.rows.get(42)!.locked_until = new Date(Date.now() - 1000);

        expect(await service.verify(42, STRONG)).toBe(true);
    }, 30000);
});

describe('PatientPortalService — changing', () => {
    it('requires the current password', async () => {
        const { service } = await build();
        await service.issuePassword(42, { password: STRONG });
        await expect(
            service.changePassword(42, 'not-the-password', 'Other#9Strong!x'),
        ).rejects.toThrow(/current password/i);
    }, 30000);

    it('enforces the policy on the new password', async () => {
        const { service } = await build();
        await service.issuePassword(42, { password: STRONG });
        await expect(
            service.changePassword(42, STRONG, 'weak'),
        ).rejects.toThrow(/policy/i);
    }, 30000);

    it('refuses a new password identical to the current one', async () => {
        // Otherwise "changing" it would leave the issued password in place.
        const { service } = await build();
        await service.issuePassword(42, { password: STRONG });
        await expect(
            service.changePassword(42, STRONG, STRONG),
        ).rejects.toThrow(/different/i);
    }, 30000);

    it('installs the new password and retires the old one', async () => {
        const { service } = await build();
        await service.issuePassword(42, { password: STRONG });
        const next = 'Nw#4sableFish!q';

        await service.changePassword(42, STRONG, next);

        expect(await service.verify(42, next)).toBe(true);
        expect(await service.verify(42, STRONG)).toBe(false);
    }, 30000);

    it('clears the must-change flag once the patient picks their own', async () => {
        const { service } = await build();
        await service.issuePassword(42, { password: STRONG });
        expect(await service.mustChangePassword(42)).toBe(true);

        await service.changePassword(42, STRONG, 'Nw#4sableFish!q');

        expect(await service.mustChangePassword(42)).toBe(false);
    }, 30000);

    it('stores the new password as a fresh hash, not the old one', async () => {
        const { service, db } = await build();
        await service.issuePassword(42, { password: STRONG });
        const before = db.rows.get(42)!.password_hash;

        await service.changePassword(42, STRONG, 'Nw#4sableFish!q');

        expect(db.rows.get(42)!.password_hash).not.toBe(before);
        expect(db.rows.get(42)!.password_hash).toMatch(/^\$2[aby]\$12\$/);
    }, 30000);

    it('refuses when the patient has no portal account', async () => {
        const { service } = await build();
        await expect(
            service.changePassword(99, STRONG, 'Nw#4sableFish!q'),
        ).rejects.toThrow(/no portal account/i);
    });
});
