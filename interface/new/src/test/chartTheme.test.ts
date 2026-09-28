import { describe, it, expect } from 'vitest';
import { chartTheme, darken, withAlpha } from '../utils/chartTheme';
import { TRIAGE_LEVELS } from '../utils/triage';

/**
 * The chart page theme.
 *
 * What matters: a patient in the department is themed by their *level* colour —
 * the same colour the board and banner use — and an ordinary chart still has a
 * sensible theme from the section colour rather than going grey.
 */
describe('withAlpha', () => {
  it('appends an alpha suffix to a hex colour', () => {
    expect(withAlpha('#dc3545', '40')).toBe('#dc354540');
  });

  it('leaves anything that is not a six-digit hex alone rather than producing junk', () => {
    expect(withAlpha('red', '40')).toBe('red');
    expect(withAlpha('', '40')).toBe('transparent');
    expect(withAlpha(undefined as any, '40')).toBe('transparent');
  });
});

describe('darken', () => {
  it('reduces every channel', () => {
    const out = darken('#ffc107', 0.5);
    expect(out).toMatch(/^#[0-9a-f]{6}$/);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16));
    expect(r).toBeLessThan(0xff);
    expect(g).toBeLessThan(0xc1);
    expect(b).toBeLessThan(0x07 + 1);
  });

  it('makes the light level colours dark enough for white text', () => {
    // Yellow (#ffc107) and Blue (#0dcaf0) are the two levels where white text on
    // the raw colour would be unreadable.
    for (const light of ['#ffc107', '#0dcaf0']) {
      const out = darken(light, 0.62);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16));
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      expect(luminance, `${light} darkened must be dark`).toBeLessThan(0.6);
    }
  });

  it('leaves a non-hex value alone rather than inventing one', () => {
    expect(darken('rgb(1,2,3)')).toBe('rgb(1,2,3)');
    expect(darken('')).toBe('#0b1020');
  });

  it('clamps a silly factor', () => {
    expect(darken('#ffffff', 5)).toBe('#ffffff');
    expect(darken('#ffffff', -3)).not.toBe('#ffffff');
  });
});

describe('chartTheme', () => {
  const tabColor = '#0d6efd';

  it('themes the page with the triage level colour while the patient is in the department', () => {
    for (const level of [1, 2, 3, 4, 5]) {
      const theme = chartTheme({ level, tabColor, inDepartment: true });
      expect(theme.accent).toBe(TRIAGE_LEVELS[level as 1].color);
      expect(theme.fromLevel).toBe(true);
      expect(theme.level).toBe(level);
      expect(theme.levelLabel).toBe(TRIAGE_LEVELS[level as 1].label);
    }
  });

  it('falls back to the section colour when there is no attendance', () => {
    const theme = chartTheme({ level: null, tabColor });
    expect(theme.accent).toBe(tabColor);
    expect(theme.fromLevel).toBe(false);
    expect(theme.level).toBeNull();
    expect(theme.levelLabel).toBeNull();
  });

  it('ignores a level for a patient who is not actually in the department', () => {
    // A closed visit leaves a recorded level behind; it must not keep colouring
    // the chart after the patient has gone home.
    const theme = chartTheme({ level: 2, tabColor, inDepartment: false });
    expect(theme.accent).toBe(tabColor);
    expect(theme.fromLevel).toBe(false);
  });

  it('survives a missing or odd section colour', () => {
    expect(chartTheme({ tabColor: '' }).accent).toBe('#0d6efd');
    expect(chartTheme({ tabColor: undefined as any }).accent).toBe('#0d6efd');
  });

  it('builds the tint, ring and shadows from the accent so they cannot drift apart', () => {
    const theme = chartTheme({ level: 2, tabColor, inDepartment: true });
    expect(theme.tint.startsWith(theme.accent)).toBe(true);
    expect(theme.ring.startsWith(theme.accent)).toBe(true);
    expect(theme.shadow).toContain(theme.accent);
    expect(theme.shadowHover).toContain(theme.accent);
    // Hover must be a deeper shadow than rest, not an identical one.
    expect(theme.shadowHover).not.toBe(theme.shadow);
  });

  it('clamps a level outside 1..5 instead of rendering no colour', () => {
    expect(chartTheme({ level: 9, tabColor, inDepartment: true }).accent).toBe(TRIAGE_LEVELS[5].color);
    expect(chartTheme({ level: 0, tabColor, inDepartment: true }).accent).toBe(TRIAGE_LEVELS[1].color);
  });
});
