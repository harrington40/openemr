/**
 * Observation entry for triage and reassessment.
 *
 * Records only what was actually measured: a blank field is sent as blank so the
 * backend floors the level rather than scoring a missing value as normal. That
 * is why this never defaults a field to a "normal" number — a prefilled pulse of
 * 72 that nobody took is worse than no value at all.
 */

export interface ObservationValues {
  respiration: string;
  oxygen_saturation: string;
  temperature: string;
  bps: string;
  bpd: string;
  pulse: string;
  painScore: string;
  onSupplementalO2: boolean;
  avpuAlert: boolean;
}

export const EMPTY_OBSERVATIONS: ObservationValues = {
  respiration: '',
  oxygen_saturation: '',
  temperature: '',
  bps: '',
  bpd: '',
  pulse: '',
  painScore: '',
  onSupplementalO2: false,
  avpuAlert: true,
};

/** Only the fields that hold a value, converted for the API. */
export function observationPayload(values: ObservationValues): Record<string, any> {
  const v: Record<string, any> = {};
  const put = (key: string, raw: string) => {
    const trimmed = String(raw ?? '').trim();
    if (trimmed === '') return;
    const n = Number(trimmed);
    if (Number.isFinite(n)) v[key] = n;
  };

  put('respiration', values.respiration);
  put('oxygen_saturation', values.oxygen_saturation);
  put('temperature', values.temperature);
  put('bps', values.bps);
  put('bpd', values.bpd);
  put('pulse', values.pulse);
  if (values.onSupplementalO2) v.onSupplementalO2 = true;
  v.avpuAlert = values.avpuAlert;

  const pain = String(values.painScore ?? '').trim();
  if (pain !== '' && Number.isFinite(Number(pain))) v.painScore = Number(pain);

  return v;
}

/** How many of the required observations are filled in. */
export function observationCompleteness(values: ObservationValues): { filled: number; total: number; complete: boolean } {
  const required = ['respiration', 'oxygen_saturation', 'temperature', 'bps', 'pulse'] as const;
  const filled = required.filter((key) => String(values[key] ?? '').trim() !== '').length;
  return { filled, total: required.length, complete: filled === required.length };
}

const FIELD_STYLE = { maxWidth: '110px' } as const;

export function ObservationFields({
  values,
  onChange,
  disabled = false,
}: {
  values: ObservationValues;
  onChange: (next: ObservationValues) => void;
  disabled?: boolean;
}) {
  const set = (key: keyof ObservationValues, value: string | boolean) => onChange({ ...values, [key]: value });
  const { complete, filled, total } = observationCompleteness(values);

  const input = (key: keyof ObservationValues, label: string, unit: string, step = '0.1') => (
    <div className="col-6 col-md-2">
      <label className="form-label small mb-1">
        {label} {unit && <span className="text-muted">{unit}</span>}
      </label>
      <input
        type="number"
        step={step}
        className="form-control form-control-sm"
        style={FIELD_STYLE}
        value={String(values[key])}
        disabled={disabled}
        onChange={(e) => set(key, e.target.value)}
        placeholder="—"
      />
    </div>
  );

  return (
    <div className="row g-2 align-items-end">
      {input('respiration', 'Resp', '/min', '1')}
      {input('oxygen_saturation', 'SpO₂', '%', '1')}
      {input('temperature', 'Temp', '°C')}
      {input('bps', 'Systolic', 'mmHg', '1')}
      {input('bpd', 'Diastolic', 'mmHg', '1')}
      {input('pulse', 'Pulse', '/min', '1')}
      {input('painScore', 'Pain', '/10', '1')}

      <div className="col-12 col-md-4">
        <div className="d-flex flex-wrap gap-3">
          <div className="form-check form-switch">
            <input className="form-check-input" type="checkbox" id="ed-on-o2" checked={values.onSupplementalO2}
              disabled={disabled} onChange={(e) => set('onSupplementalO2', e.target.checked)} />
            <label className="form-check-label small" htmlFor="ed-on-o2">On oxygen</label>
          </div>
          <div className="form-check form-switch">
            <input className="form-check-input" type="checkbox" id="ed-alert" checked={values.avpuAlert}
              disabled={disabled} onChange={(e) => set('avpuAlert', e.target.checked)} />
            <label className="form-check-label small" htmlFor="ed-alert">Alert (AVPU)</label>
          </div>
        </div>
        <div className="small mt-1" style={{ color: complete ? '#198754' : '#fd7e14' }}>
          <i className={`bi ${complete ? 'bi-check-circle' : 'bi-exclamation-triangle'} me-1`}></i>
          {complete
            ? 'Full set — the level can be graded down to Blue if nothing is wrong.'
            : `${filled}/${total} recorded — without the rest the patient cannot be graded non-urgent.`}
        </div>
      </div>
    </div>
  );
}

export default ObservationFields;
