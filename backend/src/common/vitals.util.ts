/**
 * Normalising recorded vital signs.
 *
 * The vitals forms in the SPA do not agree on field names — the patient chart
 * and the nurse-aide intake post the `form_vitals` column names, while the
 * screening form posts bp_systolic/temp/resp/o2_sat. Reading only the column
 * names silently dropped every value from the screening form and wrote the row
 * as blank, so a recorded triage set came back empty. Everything passes through
 * here, so a naming mismatch can no longer lose observations.
 *
 * Rules enforced:
 *  - a supplied numeric vital must be greater than 0 (0 is not an observation);
 *  - no NULL is written: a value that was not supplied is stored as 0;
 *  - a payload carrying no reading at all is refused instead of writing a blank row.
 */

/** Field names used by the forms, mapped onto `form_vitals` columns. */
const FIELD_ALIASES: Record<string, string> = {
  temp: 'temperature',
  resp: 'respiration',
  bp_systolic: 'bps',
  bp_diastolic: 'bpd',
  systolic: 'bps',
  diastolic: 'bpd',
  o2_sat: 'oxygen_saturation',
  spo2: 'oxygen_saturation',
  o2: 'oxygen_saturation',
  bmi: 'BMI',
  heart_rate: 'pulse',
  pulse_rate: 'pulse',
  rr: 'respiration',
  wt: 'weight',
  ht: 'height',
};

/** The numeric columns, with the label used in validation messages. */
const NUMERIC_VITALS: { column: string; label: string }[] = [
  { column: 'temperature', label: 'Temperature' },
  { column: 'pulse', label: 'Pulse' },
  { column: 'respiration', label: 'Respirations' },
  { column: 'oxygen_saturation', label: 'SpO2' },
  { column: 'weight', label: 'Weight' },
  { column: 'height', label: 'Height' },
  { column: 'BMI', label: 'BMI' },
];

export interface VitalsRow {
  bps: string | null;
  bpd: string | null;
  weight: number;
  height: number;
  temperature: number;
  pulse: number;
  respiration: number;
  BMI: number;
  BMI_status: string | null;
  oxygen_saturation: number;
  note: string | null;
}

export interface NormalisedVitals {
  row: VitalsRow;
  /** Numeric vitals that were supplied as 0 or a negative number. */
  invalid: string[];
  /** True when at least one real reading is present. */
  hasReading: boolean;
}

const text = (x: unknown): string | null => {
  const s = x === undefined || x === null ? '' : String(x).trim();
  return s === '' ? null : s;
};

/** Accepts any of the forms' payload shapes and returns column-ready values. */
export function normaliseVitals(dto: Record<string, any> | null | undefined): NormalisedVitals {
  const v: Record<string, any> = {};
  for (const [key, value] of Object.entries(dto || {})) {
    if (value === undefined || value === null || value === '') continue;
    v[FIELD_ALIASES[key] || key] = value;
  }

  const invalid: string[] = [];
  const numeric: Record<string, number> = {};
  for (const { column, label } of NUMERIC_VITALS) {
    const supplied = v[column];
    if (supplied === undefined) {
      numeric[column] = 0; // not recorded — never NULL
      continue;
    }
    const n = Number(supplied);
    if (!Number.isFinite(n) || n <= 0) {
      invalid.push(label);
      numeric[column] = 0;
      continue;
    }
    numeric[column] = n;
  }

  const row: VitalsRow = {
    // bps/bpd are varchar on form_vitals: "120" and "120/80" are both valid.
    bps: text(v.bps),
    bpd: text(v.bpd),
    weight: numeric.weight,
    height: numeric.height,
    temperature: numeric.temperature,
    pulse: numeric.pulse,
    respiration: numeric.respiration,
    BMI: numeric.BMI,
    BMI_status: text(v.BMI_status),
    oxygen_saturation: numeric.oxygen_saturation,
    note: text(v.note),
  };

  const hasReading =
    [row.bps, row.bpd].some((x) => x !== null) ||
    NUMERIC_VITALS.some(({ column }) => numeric[column] > 0);

  return { row, invalid, hasReading };
}

/** The INSERT parameters, in column order. */
export function vitalsInsertParams(row: VitalsRow): (string | number | null)[] {
  return [
    row.bps, row.bpd, row.weight, row.height, row.temperature, row.pulse,
    row.respiration, row.BMI, row.BMI_status, row.oxygen_saturation, row.note,
  ];
}
