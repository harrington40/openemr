import { describe, it, expect } from 'vitest';
import { emergencyAccent, TRIAGE_LEVELS } from '../utils/triage';

/**
 * The colour a patient's state is painted with.
 *
 * The provider dashboard colours an emergency row by the triage level. The API
 * sends the colour, but the fallback matters: an uncoloured emergency patient is
 * the one failure mode nobody would notice, so a missing or malformed `color` has
 * to fall back to the level's own colour rather than to nothing.
 */
describe('emergencyAccent', () => {
  it('uses the colour the API sent, which is the board colour', () => {
    expect(emergencyAccent({ color: '#fd7e14', level: 2 })).toBe('#fd7e14');
    expect(emergencyAccent({ color: '  #dc3545  ', level: 2 })).toBe('#dc3545');
    expect(emergencyAccent({ color: '#fff', level: 4 })).toBe('#fff');
  });

  it('falls back to the level colour when the API sends none', () => {
    for (const level of [1, 2, 3, 4, 5] as const) {
      expect(emergencyAccent({ level })).toBe(TRIAGE_LEVELS[level].color);
      expect(emergencyAccent({ color: null, level })).toBe(TRIAGE_LEVELS[level].color);
      expect(emergencyAccent({ color: '', level })).toBe(TRIAGE_LEVELS[level].color);
    }
  });

  it('ignores a value that is not a colour', () => {
    expect(emergencyAccent({ color: 'orange', level: 3 })).toBe(TRIAGE_LEVELS[3].color);
    expect(emergencyAccent({ color: 'red; background:url(x)', level: 3 })).toBe(TRIAGE_LEVELS[3].color);
    expect(emergencyAccent({ color: '12345', level: 3 })).toBe(TRIAGE_LEVELS[3].color);
  });

  it('treats a level outside the scale the way levelMeta does', () => {
    expect(emergencyAccent({ level: 0 })).toBe(TRIAGE_LEVELS[1].color);
    expect(emergencyAccent({ level: 99 })).toBe(TRIAGE_LEVELS[5].color);
    expect(emergencyAccent({})).toBe(TRIAGE_LEVELS[1].color);
  });
});
