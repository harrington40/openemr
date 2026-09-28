/**
 * Vital-sign classification & trend helpers.
 * Shared system-wide so every vital view shows the same color-coded
 * normal / borderline / abnormal indicators.
 */

export interface ClassResult {
  category: string;
  color: string;
}

const num = (v: any): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** AHA/ACC blood-pressure classification. */
export function classifyBP(systolic: any, diastolic: any): ClassResult {
  const s = num(systolic);
  const d = num(diastolic);
  if (s == null && d == null) return { category: '—', color: '#adb5bd' };
  if ((s != null && s >= 180) || (d != null && d >= 120)) return { category: 'Hypertensive Crisis', color: '#dc3545' };
  if ((s != null && s >= 140) || (d != null && d >= 90)) return { category: 'Stage 2 Hypertension', color: '#fd7e14' };
  if ((s != null && s >= 130) || (d != null && d >= 80)) return { category: 'Stage 1 Hypertension', color: '#ffc107' };
  if (s != null && s >= 120 && (d == null || d < 80)) return { category: 'Elevated', color: '#17a2b8' };
  if (s != null && s < 90) return { category: 'Hypotension', color: '#6f42c1' };
  return { category: 'Normal', color: '#198754' };
}

export function classifyPulse(pulse: any): ClassResult {
  const p = num(pulse);
  if (p == null) return { category: '—', color: '#adb5bd' };
  if (p < 50 || p > 130) return { category: 'Critical', color: '#dc3545' };
  if (p < 60 || p > 110) return { category: 'Abnormal', color: '#fd7e14' };
  return { category: 'Normal', color: '#198754' };
}

export function classifyTemp(tempF: any): ClassResult {
  // Values > 45 are treated as Fahrenheit and converted to Celsius.
  const t = num(tempF);
  if (t == null) return { category: '—', color: '#adb5bd' };
  const c = t > 45 ? Math.round(((t - 32) * 5 / 9) * 10) / 10 : t;
  if (c >= 39.1 || c <= 35.0) return { category: 'Critical', color: '#dc3545' };
  if (c >= 38.1) return { category: 'Fever', color: '#fd7e14' };
  return { category: 'Normal', color: '#198754' };
}

export function classifyResp(resp: any): ClassResult {
  const r = num(resp);
  if (r == null) return { category: '—', color: '#adb5bd' };
  if (r < 10 || r > 24) return { category: 'Critical', color: '#dc3545' };
  if (r < 12 || r > 20) return { category: 'Abnormal', color: '#fd7e14' };
  return { category: 'Normal', color: '#198754' };
}

export function classifySpO2(spo2: any): ClassResult {
  const s = num(spo2);
  if (s == null) return { category: '—', color: '#adb5bd' };
  if (s < 92) return { category: 'Critical', color: '#dc3545' };
  if (s < 94) return { category: 'Low', color: '#fd7e14' };
  return { category: 'Normal', color: '#198754' };
}

export interface TrendResult {
  symbol: string;
  color: string;
  label: string;
}

/** Compare current vs previous value and return a trend indicator. */
export function vitalTrend(current: any, previous: any): TrendResult | null {
  const c = num(current);
  const p = num(previous);
  if (c == null || p == null) return null;
  const diff = c - p;
  if (Math.abs(diff) < 0.5) return { symbol: '→', color: '#adb5bd', label: 'No change' };
  if (diff > 0) return { symbol: '▲', color: '#fd7e14', label: 'Increased' };
  return { symbol: '▼', color: '#0d6efd', label: 'Decreased' };
}

/**
 * Format a raw DB vital value (often a DECIMAL string like "0.000000") into a
 * clean, human-friendly reading. Empty / zero values become "—".
 */
export function formatVital(value: any, maxDecimals = 0): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: maxDecimals });
}

/** Format a blood pressure pair as "120/80", or "—" when both are empty. */
export function formatBP(systolic: any, diastolic: any): string {
  const s = formatVital(systolic, 0);
  const d = formatVital(diastolic, 0);
  if (s === '—' && d === '—') return '—';
  return `${s}/${d}`;
}

/** Format a vital value with a unit suffix (e.g. "36.5°", "98%"). */
export function formatVitalUnit(value: any, maxDecimals: number, unit: string): string {
  const v = formatVital(value, maxDecimals);
  return v === '—' ? '—' : `${v}${unit}`;
}
