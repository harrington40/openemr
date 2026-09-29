import {
    generatePassword,
    validatePassword,
    PASSWORD_MIN_LENGTH,
    PASSWORD_MAX_BYTES,
} from './password-policy.util';

/** A password that satisfies every rule, for use as a passing baseline. */
const GOOD = 'Kav#7tremBle!x';

describe('validatePassword', () => {
    it('accepts a password that meets the policy', () => {
        expect(validatePassword(GOOD)).toEqual({ ok: true, problems: [] });
    });

    it('rejects anything that is not a non-empty string', () => {
        expect(validatePassword('').ok).toBe(false);
        expect(validatePassword(undefined).ok).toBe(false);
        expect(validatePassword(12345678901234).ok).toBe(false);
    });

    it('enforces the minimum length', () => {
        const short = 'Ab#3defg';
        expect(short.length).toBeLessThan(PASSWORD_MIN_LENGTH);
        const result = validatePassword(short);
        expect(result.ok).toBe(false);
        expect(result.problems.join(' ')).toContain(
            `${PASSWORD_MIN_LENGTH} characters`,
        );
    });

    it('rejects a password past the bcrypt byte limit', () => {
        // bcrypt ignores everything after 72 bytes, so a longer password is not
        // actually stronger — accepting it silently would be misleading.
        const tooLong = `${GOOD}${'x'.repeat(PASSWORD_MAX_BYTES)}`;
        expect(Buffer.byteLength(tooLong, 'utf8')).toBeGreaterThan(
            PASSWORD_MAX_BYTES,
        );
        expect(validatePassword(tooLong).ok).toBe(false);
    });

    it('counts bytes, not characters, for the length limit', () => {
        // Multi-byte characters hit the cap sooner than their length suggests.
        const multibyte = `${GOOD}${'é'.repeat(50)}`;
        expect(multibyte.length).toBeLessThan(PASSWORD_MAX_BYTES + 20);
        expect(Buffer.byteLength(multibyte, 'utf8')).toBeGreaterThan(
            PASSWORD_MAX_BYTES,
        );
        expect(validatePassword(multibyte).ok).toBe(false);
    });

    it('requires each character class', () => {
        expect(validatePassword('kav7tremble#x1').problems.join(' ')).toContain(
            'uppercase',
        );
        expect(validatePassword('KAV7TREMBLE#X1').problems.join(' ')).toContain(
            'lowercase',
        );
        expect(validatePassword('KavTremble#xyz').problems.join(' ')).toContain(
            'number',
        );
        expect(validatePassword('KavTremble7xyz').problems.join(' ')).toContain(
            'symbol',
        );
    });

    it('rejects common words even when the composition rules are met', () => {
        // Passes length + all four classes, so only the deny-list can catch it.
        const result = validatePassword('Welcome2Portal!');
        expect(result.ok).toBe(false);
        expect(result.problems.join(' ')).toContain('common words');
    });

    it('rejects three or more repeated characters', () => {
        expect(validatePassword('Kav###7remBle').ok).toBe(false);
    });

    it('rejects straight runs such as abcd or 1234', () => {
        expect(validatePassword('Kav#abcd7Ble').ok).toBe(false);
        expect(validatePassword('Kav#4321Ble9').ok).toBe(false);
    });

    it('returns every problem at once rather than the first', () => {
        // So the portal can show the whole list instead of one item per round trip.
        const result = validatePassword('abc');
        expect(result.ok).toBe(false);
        expect(result.problems.length).toBeGreaterThan(1);
    });

    it('rejects control characters', () => {
        expect(validatePassword(`Kav#7trem\u0000Ble`).ok).toBe(false);
    });
});

describe('generatePassword', () => {
    it('produces a password that passes its own policy', () => {
        // The generator must satisfy the validator, or the desk hands out a
        // password the portal then refuses. A single draw trips the run rule about
        // one time in fifty, so this needs enough iterations to be reliable — the
        // original 200 gave only a ~4% chance of catching a regression.
        for (let i = 0; i < 2000; i++) {
            const generated = generatePassword();
            expect(validatePassword(generated)).toEqual({
                ok: true,
                problems: [],
            });
        }
    });

    it('honours the requested length, and never goes below the minimum', () => {
        expect(generatePassword(20)).toHaveLength(20);
        expect(generatePassword(4).length).toBeGreaterThanOrEqual(
            PASSWORD_MIN_LENGTH,
        );
    });

    it('avoids glyphs that get misread off a card', () => {
        // O/0, l/1/I and 5/S are the pairs the desk mis-transcribes.
        const joined = Array.from({ length: 100 }, () =>
            generatePassword(),
        ).join('');
        expect(joined).not.toMatch(/[O0lI1S5]/);
    });

    it('includes at least one of each required class every time', () => {
        for (let i = 0; i < 100; i++) {
            const p = generatePassword();
            expect(p).toMatch(/[A-Z]/);
            expect(p).toMatch(/[a-z]/);
            expect(p).toMatch(/[0-9]/);
            expect(p).toMatch(/[^A-Za-z0-9]/);
        }
    });

    it('does not return the same password twice', () => {
        const seen = new Set(
            Array.from({ length: 500 }, () => generatePassword()),
        );
        expect(seen.size).toBe(500);
    });
});
