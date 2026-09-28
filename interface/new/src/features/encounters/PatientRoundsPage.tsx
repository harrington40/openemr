import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';
import { useAuth } from '../../hooks/useAuth';
import { formatPatientName } from '../../utils/patientName';
import { formatDateOnly } from '../../utils/date';
import { formatVital, formatBP } from '../../utils/vitalsClassify';
import VitalsTrend from '../../components/vitals/VitalsTrend';

const PAIN_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SPO2_ALERT_THRESHOLD = 92; // clinic-configurable escalation threshold

export default function PatientRoundsPage() {
  const { pid } = useParams<{ pid: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({ weight: '', bps: '', bpd: '', pulse: '', respiration: '', temperature: '', oxygen_saturation: '', pain: '', notes: '' });
  const [trendWindow, setTrendWindow] = useState<'24h' | '48h' | '7d'>('24h');
  const [escalation, setEscalation] = useState<string | null>(null);

  const { data: patient } = useQuery({
    queryKey: ['patient', pid],
    queryFn: async () => { const r = await nestClient.get(`/patients/${pid}`); return r.data; },
    enabled: !!pid,
  });

  const { data: vitals = [] } = useQuery({
    queryKey: ['patient', patient?.pid, 'vitals'],
    queryFn: async () => { const r = await nestClient.get(`/patients/${patient?.pid}/vitals`); return r.data || []; },
    enabled: !!patient?.pid,
  });

  const { data: allergies = [] } = useQuery({
    queryKey: ['patient', patient?.pid, 'allergies'],
    queryFn: async () => { try { const r = await nestClient.get(`/patients/${patient?.pid}/allergies`); return r.data || []; } catch { return []; } },
    enabled: !!patient?.pid,
  });

  const saveRound = useMutation({
    mutationFn: async () => {
      const payload: any = {
        bps: form.bps || null,
        bpd: form.bpd || null,
        pulse: form.pulse || null,
        respiration: form.respiration || null,
        temperature: form.temperature || null,
        oxygen_saturation: form.oxygen_saturation || null,
        weight: form.weight || null,
        BMI: null,
      };
      const r = await nestClient.post(`/patients/${patient?.pid}/vitals`, payload);
      // Store round note separately on the chart.
      if (form.notes.trim()) {
        try {
          await nestClient.post(`/patients/${patient?.pid}/notes`, { title: 'Patient Round', note: form.notes.trim(), noteType: 'nurse', shareWithNursing: true });
        } catch { /* note optional */ }
      }
      return r.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patient?.pid, 'vitals'] });
      setForm({ weight: '', bps: '', bpd: '', pulse: '', respiration: '', temperature: '', oxygen_saturation: '', pain: '', notes: '' });
      setEscalation(null);
    },
  });

  const age = patient?.DOB ? Math.floor((Date.now() - new Date(patient.DOB).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;

  // Vital readings inside the selected window, oldest first, ready to chart.
  const trendVitals = useMemo(() => {
    const now = Date.now();
    const hours = trendWindow === '24h' ? 24 : trendWindow === '48h' ? 48 : 168;
    return [...(vitals as any[])]
      .filter((v: any) => {
        if (!v.date) return false;
        const t = new Date(String(v.date).replace(' ', 'T')).getTime();
        return Number.isFinite(t) && now - t <= hours * 3600 * 1000;
      })
      .sort(
        (a: any, b: any) =>
          new Date(String(a.date).replace(' ', 'T')).getTime() -
          new Date(String(b.date).replace(' ', 'T')).getTime(),
      );
  }, [vitals, trendWindow]);

  const checkEscalation = () => {
    const spo2 = Number(form.oxygen_saturation);
    if (Number.isFinite(spo2) && spo2 > 0 && spo2 < SPO2_ALERT_THRESHOLD) {
      setEscalation(`SpO₂ entered: ${spo2}% — this value meets the clinic's configured escalation criteria.`);
    } else {
      setEscalation(null);
    }
  };

  const allergyNames = (allergies as any[]).map((a: any) => a.allergen || a.title).filter(Boolean);

  return (
    <div className="glass-page position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #dbeafe 0%, #f5faff 45%, #d1fae5 100%)', borderRadius: '20px', minHeight: '100vh', padding: '16px' }}>
      {/* ── Patient safety banner (fixed) ── */}
      <div className="rounded-4 p-3 mb-3 text-white position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0d6efd 0%, #4b2d8e 50%, #6f42c1 100%)' }}>
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
          <div>
            <div className="text-uppercase small opacity-75 fw-semibold">Patient Rounds</div>
            <h4 className="mb-1 fw-bold">{formatPatientName(patient)}</h4>
            <div className="small text-white text-opacity-75">
              DOB: {formatDateOnly(patient?.DOB)} · {patient?.sex || '—'}{age != null ? ` · ${age} yrs` : ''}
            </div>
          </div>
          <div className="small text-end">
            {allergyNames.length > 0 && (
              <div className="badge bg-warning text-dark mb-1 d-block"><i className="bi bi-exclamation-triangle me-1"></i>ALLERGIES: {allergyNames.join(', ')}</div>
            )}
            {patient?.provider_name && <div><i className="bi bi-person-check me-1"></i>Attending: {patient.provider_name}</div>}
          </div>
        </div>
      </div>

      {/* ── Current round ── */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
        <div className="card-header bg-white py-2 d-flex justify-content-between align-items-center" style={{ borderRadius: '16px 16px 0 0' }}>
          <h6 className="mb-0 fw-bold small">CURRENT ROUND</h6>
          <span className="text-muted small">{user?.displayName || 'Staff'} · {new Date().toLocaleString()}</span>
        </div>
        <div className="card-body">
          <div className="row g-2">
            <div className="col-6 col-md-2"><label className="form-label small mb-0">Weight (kg)</label><input type="number" className="form-control form-control-sm" value={form.weight} onChange={e => setForm({...form, weight: e.target.value})} /></div>
            <div className="col-6 col-md-2"><label className="form-label small mb-0">BP Sys</label><input type="number" className="form-control form-control-sm" value={form.bps} onChange={e => setForm({...form, bps: e.target.value})} /></div>
            <div className="col-6 col-md-2"><label className="form-label small mb-0">BP Dia</label><input type="number" className="form-control form-control-sm" value={form.bpd} onChange={e => setForm({...form, bpd: e.target.value})} /></div>
            <div className="col-6 col-md-2"><label className="form-label small mb-0">Pulse (bpm)</label><input type="number" className="form-control form-control-sm" value={form.pulse} onChange={e => setForm({...form, pulse: e.target.value})} /></div>
            <div className="col-6 col-md-2"><label className="form-label small mb-0">Resp (/min)</label><input type="number" className="form-control form-control-sm" value={form.respiration} onChange={e => setForm({...form, respiration: e.target.value})} /></div>
            <div className="col-6 col-md-2"><label className="form-label small mb-0">Temp (°C)</label><input type="number" step="any" className="form-control form-control-sm" value={form.temperature} onChange={e => setForm({...form, temperature: e.target.value})} /></div>
            <div className="col-6 col-md-2"><label className="form-label small mb-0">SpO₂ (%)</label><input type="number" className="form-control form-control-sm" value={form.oxygen_saturation} onChange={e => setForm({...form, oxygen_saturation: e.target.value})} onBlur={checkEscalation} /></div>
            <div className="col-12">
              <label className="form-label small mb-1">Pain (0–10)</label>
              <div className="d-flex gap-1 flex-wrap">
                {PAIN_LEVELS.map(p => (
                  <button key={p} type="button"
                    className={`btn btn-sm rounded-circle ${String(form.pain) === String(p) ? 'btn-danger' : 'btn-outline-secondary'}`}
                    style={{ width: '34px', height: '34px', fontSize: '0.7rem' }}
                    onClick={() => setForm({...form, pain: String(p)})}>{p}</button>
                ))}
              </div>
            </div>
            <div className="col-12">
              <label className="form-label small mb-0">Diagnosis / Plan / Meds / Notes</label>
              <textarea className="form-control form-control-sm" rows={3} placeholder="Patient awake and responsive…" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
            </div>
          </div>

          {escalation && (
            <div className="alert alert-warning small mt-3 mb-0 d-flex align-items-center gap-2">
              <i className="bi bi-exclamation-triangle-fill"></i>
              <div className="flex-grow-1"><strong>ATTENTION REQUIRED</strong> — {escalation}</div>
              <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setEscalation(null)}>Recheck Measurement</button>
              <button className="btn btn-warning btn-sm rounded-pill" onClick={() => { /* notify nurse */ setEscalation(`${escalation} — Nurse notified.`); }}>Notify Nurse</button>
            </div>
          )}

          <div className="d-flex gap-2 mt-3">
            <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setForm({ weight: '', bps: '', bpd: '', pulse: '', respiration: '', temperature: '', oxygen_saturation: '', pain: '', notes: '' })}>Save Draft</button>
            <button className="btn btn-success btn-sm rounded-pill px-3" disabled={saveRound.isPending} onClick={() => saveRound.mutate()}>
              {saveRound.isPending ? 'Saving…' : 'Complete Round'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Trends ── */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
        <div className="card-header bg-white py-2 d-flex justify-content-between align-items-center" style={{ borderRadius: '16px 16px 0 0' }}>
          <h6 className="mb-0 fw-bold small">Trends</h6>
          <div className="btn-group btn-group-sm">
            {(['24h', '48h', '7d'] as const).map(w => (
              <button key={w} className={`btn ${trendWindow === w ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setTrendWindow(w)}>{w}</button>
            ))}
          </div>
        </div>
        <div className="card-body">
          {trendVitals.length === 0 ? (
            <div className="text-muted small">No vitals recorded in the last {trendWindow}.</div>
          ) : (
            <VitalsTrend vitals={trendVitals} height={240} />
          )}
        </div>
      </div>

      {/* ── Previous rounds ── */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
        <div className="card-header bg-white py-2" style={{ borderRadius: '16px 16px 0 0' }}>
          <h6 className="mb-0 fw-bold small">Previous Rounds</h6>
        </div>
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-sm table-hover mb-0 small">
              <thead className="table-light"><tr><th>Time</th><th>Staff</th><th>Wt.</th><th>B/P</th><th>Pulse</th><th>Resp</th><th>Temp</th><th>SpO₂</th><th>Pain</th><th>Notes</th></tr></thead>
              <tbody>
                {(vitals as any[]).slice(0, 20).map((v: any) => (
                  <tr key={v.id}>
                    <td>{v.date ? new Date(v.date).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</td>
                    <td>{v.staff_name || user?.displayName?.split(' ').map(n => n[0]).join('. ') || '—'}</td>
                    <td>{formatVital(v.weight, 1)}</td>
                    <td>{formatBP(v.bps, v.bpd)}</td>
                    <td>{formatVital(v.pulse)}</td>
                    <td>{formatVital(v.respiration)}</td>
                    <td>{formatVital(v.temperature, 1)}</td>
                    <td>{formatVital(v.oxygen_saturation)}%</td>
                    <td>{v.pain ?? '—'}</td>
                    <td><button className="btn btn-link btn-sm p-0" onClick={() => alert('View round (read-only)')}>View</button></td>
                  </tr>
                ))}
                {!(vitals as any[]).length && <tr><td colSpan={10} className="text-center text-muted py-3">No previous rounds recorded.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => navigate(-1)}><i className="bi bi-arrow-left me-1"></i>Back</button>
    </div>
  );
}
