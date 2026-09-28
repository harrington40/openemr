import type { VitalSign } from '../../types/encounter';
import { formatVital, formatBP } from '../../utils/vitalsClassify';

interface Props {
  pid: string;
  eid: string;
  vitals: VitalSign[];
}

export default function VitalSignsForm({ vitals }: Props) {
  if (vitals.length === 0) {
    return (
      <div className="card">
        <div className="card-header">
          <h5 className="mb-0">Vital Signs</h5>
        </div>
        <div className="card-body text-center text-muted p-4">
          <i className="bi bi-heart-pulse" style={{ fontSize: '2rem' }}></i>
          <p className="mt-2 mb-0">No vital signs recorded for this encounter.</p>
        </div>
      </div>
    );
  }

  // Display the most recent vitals
  const latest = vitals[vitals.length - 1];

  const vitalFields: { label: string; value: string | undefined; unit: string }[] = [
    { label: 'Blood Pressure', value: formatBP(latest.BP_systolic, latest.BP_diastolic), unit: 'mmHg' },
    { label: 'Heart Rate', value: formatVital(latest.pulse), unit: 'bpm' },
    { label: 'Temperature', value: formatVital(latest.temperature, 1), unit: '°F/°C' },
    { label: 'Respiration', value: formatVital(latest.respiration), unit: '/min' },
    { label: 'O2 Saturation', value: formatVital(latest.oxygen_saturation), unit: '%' },
    { label: 'Weight', value: formatVital(latest.weight, 1), unit: 'lbs/kg' },
    { label: 'Height', value: formatVital(latest.height, 1), unit: 'in/cm' },
    { label: 'BMI', value: formatVital(latest.BMI, 1), unit: 'kg/m²' },
    { label: 'Waist Circumference', value: formatVital(latest.waist_circumference, 1), unit: 'in/cm' },
    { label: 'Head Circumference', value: formatVital(latest.head_circumference, 1), unit: 'in/cm' },
  ];

  return (
    <div className="card">
      <div className="card-header">
        <h5 className="mb-0">Vital Signs</h5>
      </div>
      <div className="card-body">
        <div className="text-muted small mb-3">
          Recorded: {latest.date || 'Unknown'}
        </div>
        <div className="row">
          {vitalFields.map((field) => (
            <div className="col-md-3 col-sm-4 col-6 mb-3" key={field.label}>
              <div className="card bg-light h-100">
                <div className="card-body text-center py-3">
                  <div className="text-muted small text-uppercase mb-1">{field.label}</div>
                  <div className="fw-bold fs-5">
                    {field.value || <span className="text-muted">—</span>}
                  </div>
                  <div className="text-muted small">{field.unit}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
