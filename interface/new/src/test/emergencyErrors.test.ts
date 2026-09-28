import { describe, it, expect } from 'vitest';
import { describeEmergencyError } from '../api/endpoints/emergency';

/**
 * Turning a failed metrics request into something actionable.
 *
 * The bug this exists for: the Metrics tab spun forever whenever the request was
 * rejected, because the panel could not tell "no data yet" from "not allowed".
 * The distinction that matters is whether retrying could possibly help.
 */
const httpError = (status: number, message?: string) => ({
  response: { status, data: message ? { message } : {} },
});

describe('describeEmergencyError', () => {
  it('explains a 403 as a role limit, and says retrying is pointless', () => {
    const state = describeEmergencyError(httpError(403));
    expect(state.title).toMatch(/not available for your role/i);
    expect(state.detail).toMatch(/admin, physician, nurse, midwife/);
    expect(state.canRetry).toBe(false);
    expect(state.status).toBe(403);
  });

  it('treats a 401 as an expired session, not a role problem', () => {
    const state = describeEmergencyError(httpError(401));
    expect(state.title).toMatch(/session has expired/i);
    expect(state.canRetry).toBe(false);
  });

  it('offers a retry for a server fault, and passes the server message through', () => {
    const state = describeEmergencyError(httpError(500));
    expect(state.canRetry).toBe(true);
    expect(state.title).toMatch(/server could not produce/i);

    const withMessage = describeEmergencyError(httpError(503, 'Database is down'));
    expect(withMessage.detail).toBe('Database is down');
  });

  it('offers a retry when the server could not be reached at all', () => {
    const state = describeEmergencyError(new Error('Network Error'));
    expect(state.canRetry).toBe(true);
    expect(state.status).toBeNull();
    expect(state.title).toMatch(/could not reach/i);
  });

  it('never renders an empty title or detail for an unforeseen shape', () => {
    for (const err of [null, undefined, {}, { response: {} }, 'boom']) {
      const state = describeEmergencyError(err);
      expect(state.title.length).toBeGreaterThan(0);
      expect(state.detail.length).toBeGreaterThan(0);
    }
  });

  it('describes other rejections without pretending they are retryable failures of ours', () => {
    const state = describeEmergencyError(httpError(400, 'days must be a number'));
    expect(state.detail).toBe('days must be a number');
    expect(state.status).toBe(400);
  });
});
