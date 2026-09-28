import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../../api/nest-client';
import { readOnlyNote } from '../../../utils/clinicalPermissions';
import { classifyBP, classifyPulse, classifyTemp, classifyResp, classifySpO2, vitalTrend, formatVital, formatBP, formatVitalUnit } from '../../../utils/vitalsClassify';
import VitalsTrend from '../../../components/vitals/VitalsTrend';
import VitalsViewToggle, { type VitalsView } from '../../../components/vitals/VitalsViewToggle';
import type { VitalPoint } from '../../../components/vitals/VitalsTrendChart';

interface Props {
  vitals: VitalPoint[];
  patientId: string;
  /** False when the API would refuse the write — the form is hidden, not silently 403. */
  readOnly?: boolean;
  role?: string;
}

const emptyForm = {
  bps: '', bpd: '', pulse: '', temperature: '',
  respiration: '', oxygen_saturation: '', weight: '', height: '',
  BMI: '', note: '',
};

export default function VitalsTab({ vitals, patientId, readOnly = false, role }: Props) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [view, setView] = useState<VitalsView>('chart');
  const [form, setForm] = useState(emptyForm);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState('');

  const createVital = useMutation({
    mutationFn: (d: any) => nestClient.post(`/patients/${patientId}/vitals`, d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId, 'vitals'] });
      setProblem('');
      setForm(emptyForm);
      setSaved(true);
      setTimeout(() => { setSaved(false); setShowForm(false); }, 1500);
    },
    // Previously a refused write closed over nothing and the form just sat there.
    onError: (err: any) => {
      const message = err?.response?.data?.message;
      setProblem(
        (Array.isArray(message) ? message.join(' ') : message) ||
        err?.message ||
        'The vitals could not be saved.',
      );
    },
  });

  const setField = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = () => {
    const payload: any = {};
    if (form.bps) payload.bps = form.bps;
    if (form.bpd) payload.bpd = form.bpd;
    if (form.pulse) payload.pulse = Number(form.pulse);
    if (form.temperature) payload.temperature = Number(form.temperature);
    if (form.respiration) payload.respiration = Number(form.respiration);
    if (form.oxygen_saturation) payload.oxygen_saturation = Number(form.oxygen_saturation);
    if (form.weight) payload.weight = Number(form.weight);
    if (form.height) payload.height = Number(form.height);
    if (form.BMI) payload.BMI = Number(form.BMI);
    if (form.note) payload.note = form.note;

    // Auto-calculate BMI if weight (kg) and height (cm) provided
    if (payload.weight && payload.height && !payload.BMI) {
      const h_m = Number(payload.height) / 100;
      payload.BMI = Math.round((Number(payload.weight) / (h_m * h_m)) * 10) / 10;
    }

    createVital.mutate(payload);
  };

  return (
    <div>
      {/* Quick Entry Form */}
      <div className="card mb-3 border-primary">
        <div className="card-header bg-primary text-white d-flex justify-content-between align-items-center py-2">
          <h6 className="mb-0">
            <i className="bi bi-heart-pulse me-2"></i>
            {showForm ? 'Record Vital Signs' : 'Vital Signs'}
          </h6>
          {!showForm && !readOnly && (
            <button className="btn btn-sm btn-light" onClick={() => setShowForm(true)}>
              <i className="bi bi-plus-lg me-1"></i>Record Vitals
            </button>
          )}
        </div>

        {readOnly && (
          <div className="card-body py-2">
            <div className="alert alert-light border py-2 mb-0 small">
              <i className="bi bi-lock me-1"></i>{readOnlyNote('vitals', role)}
            </div>
          </div>
        )}

        {showForm && (
          <div className="card-body bg-light">
            {saved && (
              <div className="alert alert-success py-2 mb-3 small">
                <i className="bi bi-check-circle me-1"></i>Vital signs recorded successfully!
              </div>
            )}
            {problem && (
              <div className="alert alert-danger py-2 mb-3 small">
                <i className="bi bi-exclamation-triangle me-1"></i>{problem}
              </div>
            )}
            <div className="row g-2">
              {/* Blood Pressure */}
              <div className="col-md-2 col-sm-4 col-6">
                <label className="form-label small fw-semibold">Systolic BP</label>
                <div className="input-group input-group-sm">
                  <input type="number" className="form-control" placeholder="120" value={form.bps}
                    onChange={e => setField('bps', e.target.value)} />
                  <span className="input-group-text">mmHg</span>
                </div>
              </div>
              <div className="col-md-2 col-sm-4 col-6">
                <label className="form-label small fw-semibold">Diastolic BP</label>
                <div className="input-group input-group-sm">
                  <input type="number" className="form-control" placeholder="80" value={form.bpd}
                    onChange={e => setField('bpd', e.target.value)} />
                  <span className="input-group-text">mmHg</span>
                </div>
              </div>
              {/* Pulse */}
              <div className="col-md-2 col-sm-4 col-6">
                <label className="form-label small fw-semibold">Pulse</label>
                <div className="input-group input-group-sm">
                  <input type="number" className="form-control" placeholder="72" value={form.pulse}
                    onChange={e => setField('pulse', e.target.value)} />
                  <span className="input-group-text">bpm</span>
                </div>
              </div>
              {/* Temperature */}
              <div className="col-md-2 col-sm-4 col-6">
                <label className="form-label small fw-semibold">Temperature</label>
                <div className="input-group input-group-sm">
                  <input type="number" step="0.1" className="form-control" placeholder="98.6" value={form.temperature}
                    onChange={e => setField('temperature', e.target.value)} />
                  <span className="input-group-text">°F</span>
                </div>
              </div>
              {/* Respiration */}
              <div className="col-md-2 col-sm-4 col-6">
                <label className="form-label small fw-semibold">Respiration</label>
                <div className="input-group input-group-sm">
                  <input type="number" className="form-control" placeholder="16" value={form.respiration}
                    onChange={e => setField('respiration', e.target.value)} />
                  <span className="input-group-text">/min</span>
                </div>
              </div>
              {/* O2 Saturation */}
              <div className="col-md-2 col-sm-4 col-6">
                <label className="form-label small fw-semibold">O₂ Saturation</label>
                <div className="input-group input-group-sm">
                  <input type="number" className="form-control" placeholder="98" value={form.oxygen_saturation}
                    onChange={e => setField('oxygen_saturation', e.target.value)} />
                  <span className="input-group-text">%</span>
                </div>
              </div>
              {/* Weight */}
              <div className="col-md-2 col-sm-4 col-6">
                <label className="form-label small fw-semibold">Weight</label>
                <div className="input-group input-group-sm">
                  <input type="number" step="0.1" className="form-control" placeholder="70" value={form.weight}
                    onChange={e => setField('weight', e.target.value)} />
                  <span className="input-group-text">kg</span>
                </div>
              </div>
              {/* Height */}
              <div className="col-md-2 col-sm-4 col-6">
                <label className="form-label small fw-semibold">Height</label>
                <div className="input-group input-group-sm">
                  <input type="number" step="0.1" className="form-control" placeholder="170" value={form.height}
                    onChange={e => setField('height', e.target.value)} />
                  <span className="input-group-text">cm</span>
                </div>
              </div>
              {/* BMI (auto or manual) */}
              <div className="col-md-2 col-sm-4 col-6">
                <label className="form-label small fw-semibold">BMI</label>
                <div className="input-group input-group-sm">
                  <input type="number" step="0.1" className="form-control" placeholder="Auto" value={form.BMI}
                    onChange={e => setField('BMI', e.target.value)} />
                  <span className="input-group-text">kg/m²</span>
                </div>
                <small className="text-muted">Auto if weight + height filled</small>
              </div>
              {/* Note */}
              <div className="col-md-4 col-sm-6 col-12">
                <label className="form-label small fw-semibold">Note</label>
                <input type="text" className="form-control form-control-sm" placeholder="Optional note..." value={form.note}
                  onChange={e => setField('note', e.target.value)} />
              </div>
            </div>
            {/* Action buttons */}
            <div className="d-flex gap-2 mt-3">
              <button className="btn btn-primary btn-sm" onClick={handleSubmit}
                disabled={createVital.isPending}>
                <i className={`bi ${createVital.isPending ? 'bi-hourglass-split' : 'bi-check-lg'} me-1`}></i>
                {createVital.isPending ? 'Saving...' : 'Save Vital Signs'}
              </button>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => { setShowForm(false); setForm(emptyForm); }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {vitals.length === 0 && !showForm && (
        <div className="card">
          <div className="card-body text-center text-muted p-4">
            <i className="bi bi-heart-pulse" style={{ fontSize: '2rem' }}></i>
            <p className="mt-2 mb-0">No vital signs recorded yet.</p>
            {!readOnly && (
              <button className="btn btn-primary btn-sm mt-2" onClick={() => setShowForm(true)}>
                <i className="bi bi-plus-lg me-1"></i>Record First Vitals
              </button>
            )}
          </div>
        </div>
      )}

      {vitals.length > 0 && (
        <>
          {/* View toggle — kept outside the card it controls, so both views
              stay reachable once one of them is showing. */}
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h6 className="mb-0"><i className="bi bi-graph-up me-2"></i>Vital Sign Trends</h6>
            <VitalsViewToggle view={view} onChange={setView} />
          </div>

          {/* Line chart per vital sign; the metric is picked with the pill buttons. */}
          {view !== 'table' && (
            <div className="card mb-3">
              <div className="card-body">
                <VitalsTrend vitals={vitals} height={300} />
                <div className="text-muted mt-2" style={{ fontSize: '0.7rem' }}>
                  <i className="bi bi-info-circle me-1"></i>
                  Shaded band marks the normal reference range. Points are plotted on the date each reading was taken.
                </div>
              </div>
            </div>
          )}

          {/* Table */}
          {view !== 'chart' && (
          <div className="card">
            <div className="card-header"><h6 className="mb-0"><i className="bi bi-table me-2"></i>History</h6></div>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-sm table-hover mb-0">
                  <thead className="table-light">
                    <tr><th>Date</th><th>BP</th><th>Pulse</th><th>Temp</th><th>Resp</th><th>SpO2</th><th>Weight</th><th>BMI</th></tr>
                  </thead>
                  <tbody>
                    {vitals.map((v, i) => {
                      const prev = vitals[i + 1];
                      const bp = classifyBP(v.bps, v.bpd);
                      const bpTrend = vitalTrend(v.bps, prev?.bps);
                      return (
                        <tr key={v.id}>
                          <td>{v.date ? new Date(v.date).toLocaleDateString() : '—'}</td>
                          <td>
                            <span className="fw-semibold" style={{ color: bp.color }}>{formatBP(v.bps, v.bpd)}</span>
                            {bpTrend && <span className="ms-1" style={{ color: bpTrend.color, fontSize: '0.7rem' }} title={bpTrend.label}>{bpTrend.symbol}</span>}
                          </td>
                          <td><span className="fw-semibold" style={{ color: classifyPulse(v.pulse).color }}>{formatVital(v.pulse)}</span></td>
                          <td><span className="fw-semibold" style={{ color: classifyTemp(v.temperature).color }}>{formatVitalUnit(v.temperature, 1, '°')}</span></td>
                          <td><span className="fw-semibold" style={{ color: classifyResp(v.respiration).color }}>{formatVital(v.respiration)}</span></td>
                          <td><span className="fw-semibold" style={{ color: classifySpO2(v.oxygen_saturation).color }}>{formatVitalUnit(v.oxygen_saturation, 0, '%')}</span></td>
                          <td>{formatVitalUnit(v.weight, 1, ' kg')}</td>
                          <td>{formatVital(v.BMI, 1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          )}
        </>
      )}
    </div>
  );
}
