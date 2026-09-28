/**
 * Nursing safety-first algorithm — NEWS2 early-warning scoring, critical-value
 * flagging, and prioritised care actions. Used by the Registered Nurse
 * workspace to surface the sickest patients first while keeping care efficient.
 */

export interface VitalsSnapshot {
  bps?: number | string | null;
  bpd?: number | string | null;
  pulse?: number | string | null;
  temperature?: number | string | null;
  respiration?: number | string | null;
  oxygen_saturation?: number | string | null;
  onSupplementalO2?: boolean;
  isAVPU_Alert?: boolean;
}

export interface SafetyFlag {
  code: string;
  label: string;
  severity: 'critical' | 'warning';
  action: string;
}

export interface RiskAssessment {
  total: number;
  level: 'Critical' | 'High' | 'Moderate' | 'Low' | 'Normal';
  color: string;
  badge: string;
  action: string;
  flags: SafetyFlag[];
}

const num = (v: number | string | null | undefined): number => {
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/** NEWS2 — National Early Warning Score 2. */
export function computeNEWS2(v: VitalsSnapshot): {
  total: number;
  riskLevel: string;
  color: string;
  action: string;
} {
  const resp = num(v.respiration);
  const spo2 = num(v.oxygen_saturation);
  const temp = num(v.temperature);
  const sbp = num(v.bps);
  const pulse = num(v.pulse);

  let score = 0;

  if (!Number.isNaN(resp)) {
    if (resp <= 8) score += 3;
    else if (resp <= 11) score += 1;
    else if (resp <= 20) score += 0;
    else if (resp <= 24) score += 2;
    else score += 3;
  }

  if (!Number.isNaN(spo2)) {
    if (spo2 <= 91) score += 3;
    else if (spo2 <= 93) score += 2;
    else if (spo2 <= 95) score += 1;
  }
  if (v.onSupplementalO2) score += 2;

  if (!Number.isNaN(temp)) {
    if (temp <= 35.0) score += 3;
    else if (temp <= 36.0) score += 1;
    else if (temp <= 38.0) score += 0;
    else if (temp <= 39.0) score += 1;
    else score += 2;
  }

  if (!Number.isNaN(sbp)) {
    if (sbp <= 90) score += 3;
    else if (sbp <= 100) score += 2;
    else if (sbp <= 110) score += 1;
    else if (sbp >= 220) score += 3;
  }

  if (!Number.isNaN(pulse)) {
    if (pulse <= 40) score += 3;
    else if (pulse <= 50) score += 1;
    else if (pulse <= 90) score += 0;
    else if (pulse <= 110) score += 1;
    else if (pulse <= 130) score += 2;
    else score += 3;
  }

  if (v.isAVPU_Alert === false) score += 3;

  if (score >= 7) {
    return { total: score, riskLevel: 'HIGH — Emergency', color: '#dc3545', action: 'Continuous monitoring. Emergency assessment by critical care team. Consider ICU transfer.' };
  }
  if (score >= 5) {
    return { total: score, riskLevel: 'MEDIUM — Urgent', color: '#fd7e14', action: 'Urgent clinical review within 1 hour. Escalate to senior clinician.' };
  }
  if (score >= 3) {
    return { total: score, riskLevel: 'LOW — Monitor', color: '#ffc107', action: 'Increase monitoring frequency. Review within 4 hours.' };
  }
  return { total: score, riskLevel: 'Normal', color: '#198754', action: 'Continue routine monitoring.' };
}

/** Flag critical / abnormal single values with immediate safety actions. */
export function criticalFlags(v: VitalsSnapshot): SafetyFlag[] {
  const flags: SafetyFlag[] = [];
  const resp = num(v.respiration);
  const spo2 = num(v.oxygen_saturation);
  const sbp = num(v.bps);
  const dbp = num(v.bpd);
  const pulse = num(v.pulse);
  const temp = num(v.temperature);

  if (!Number.isNaN(spo2) && spo2 < 92) {
    flags.push({ code: 'SPO2', label: `SpO₂ ${spo2}%`, severity: 'critical', action: 'Apply oxygen, check airway, escalate immediately.' });
  } else if (!Number.isNaN(spo2) && spo2 < 94) {
    flags.push({ code: 'SPO2', label: `SpO₂ ${spo2}%`, severity: 'warning', action: 'Sit patient up, titrate O₂, recheck in 15 min.' });
  }

  if (!Number.isNaN(resp) && (resp < 10 || resp > 24)) {
    flags.push({ code: 'RESP', label: `Resp ${resp}/min`, severity: resp < 10 ? 'critical' : 'warning', action: 'Assess airway/breathing, escalate if worsening.' });
  }

  if (!Number.isNaN(sbp) && (sbp < 90 || sbp > 180)) {
    flags.push({ code: 'BP', label: `SBP ${sbp}`, severity: 'critical', action: sbp < 90 ? 'Lay patient flat, IV fluids, escalate.' : 'Treat hypertensive urgency, notify provider.' });
  } else if (!Number.isNaN(sbp) && sbp < 100) {
    flags.push({ code: 'BP', label: `SBP ${sbp}`, severity: 'warning', action: 'Monitor BP trend, recheck within 30 min.' });
  }
  if (!Number.isNaN(dbp) && dbp > 110) {
    flags.push({ code: 'DBP', label: `DBP ${dbp}`, severity: 'warning', action: 'Recheck BP, notify provider.' });
  }

  if (!Number.isNaN(pulse) && (pulse < 50 || pulse > 130)) {
    flags.push({ code: 'PULSE', label: `Pulse ${pulse}`, severity: 'critical', action: 'Continuous monitoring, obtain ECG, escalate.' });
  } else if (!Number.isNaN(pulse) && pulse > 110) {
    flags.push({ code: 'PULSE', label: `Pulse ${pulse}`, severity: 'warning', action: 'Assess rhythm and hydration, recheck in 30 min.' });
  }

  if (!Number.isNaN(temp) && (temp >= 39.1 || temp <= 35.0)) {
    flags.push({ code: 'TEMP', label: `Temp ${temp}°C`, severity: 'critical', action: temp >= 39.1 ? 'Antipyretics, cultures, sepsis screen.' : 'Warm patient, check thyroid/glucose.' });
  } else if (!Number.isNaN(temp) && temp >= 38.1) {
    flags.push({ code: 'TEMP', label: `Temp ${temp}°C`, severity: 'warning', action: 'Monitor temperature, encourage fluids.' });
  }

  if (v.isAVPU_Alert === false) {
    flags.push({ code: 'AVPU', label: 'Not fully alert', severity: 'critical', action: 'Immediate neurological assessment and escalation.' });
  }

  return flags;
}

/**
 * Combined safety assessment — merges NEWS2 with acuity level and single
 * critical-value flags to prioritise the sickest patients first.
 */
export function assessPatient(
  vitals: VitalsSnapshot | null | undefined,
  acuity?: string | null,
): RiskAssessment {
  const news = computeNEWS2(vitals || {});
  const flags = criticalFlags(vitals || {});
  const hasCriticalFlag = flags.some((f) => f.severity === 'critical');
  const isStat = acuity === 'stat';
  const isUrgent = acuity === 'urgent';

  const total = news.total + (isStat ? 4 : isUrgent ? 2 : 0) + (hasCriticalFlag ? 2 : 0);

  let level: RiskAssessment['level'];
  let color: string;
  let action: string;
  if (isStat || total >= 7 || hasCriticalFlag) {
    level = 'Critical'; color = '#dc3545';
    action = 'Act now — continuous monitoring, escalate to provider/rapid response.';
  } else if (isUrgent || total >= 5) {
    level = 'High'; color = '#fd7e14';
    action = 'Urgent review within 1 hour. Escalate if deteriorating.';
  } else if (total >= 3) {
    level = 'Moderate'; color = '#ffc107';
    action = 'Increase monitoring frequency. Review within 4 hours.';
  } else if (total >= 1) {
    level = 'Low'; color = '#17a2b8';
    action = 'Routine monitoring with attention to flagged trends.';
  } else {
    level = 'Normal'; color = '#198754';
    action = 'Continue routine monitoring.';
  }

  return { total, level, color, badge: riskBadge(level), action, flags };
}

export function riskBadge(level: RiskAssessment['level']): string {
  switch (level) {
    case 'Critical': return 'bg-danger';
    case 'High': return 'bg-warning text-dark';
    case 'Moderate': return 'bg-info text-dark';
    case 'Low': return 'bg-secondary';
    default: return 'bg-success';
  }
}
