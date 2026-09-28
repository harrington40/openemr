import { useState, useMemo } from 'react';
import { formatDateTime } from '../../utils/date';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { useDebounce } from '../../hooks/useDebounce';
import nestClient from '../../api/nest-client';
import {
  assessPatient,
  computeNEWS2,
  riskBadge,
  type VitalsSnapshot,
} from '../../utils/nursingSafety';
import { classifyBP, formatVital, formatBP } from '../../utils/vitalsClassify';
import { formatPatientName } from '../../utils/patientName';

/** Normalise a vitals row into a snapshot for the safety algorithm. */
function toSnapshot(v: any): VitalsSnapshot {
  const nz = (x: any): number | string | null => {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const temp = Number(v?.temperature);
  const tempC = Number.isFinite(temp) && temp > 45
    ? Math.round(((temp - 32) * 5 / 9) * 10) / 10
    : Number.isFinite(temp) && temp > 0 ? temp : null;
  return {
    bps: nz(v?.bps), bpd: nz(v?.bpd), pulse: nz(v?.pulse),
    temperature: tempC,
    respiration: nz(v?.respiration),
    oxygen_saturation: nz(v?.oxygen_saturation),
  };
}

function riskRank(level: string): number {
  switch (level) {
    case 'Critical': return 4;
    case 'High': return 3;
    case 'Moderate': return 2;
    case 'Low': return 1;
    default: return 0;
  }
}

export default function NurseRNDashboardPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 250);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [tab, setTab] = useState('meds');

  // ── Forms ─────────────────────────────────────────────────────────────
  const [planForm, setPlanForm] = useState({ description: '', care_plan_type: 'nursing' });
  const [noteForm, setNoteForm] = useState({ title: '', note: '' });

  // ── RN dashboard: active ward patients + shared notes ─────────────────
  const { data: nurseData } = useQuery({
    queryKey: ['nurse-dashboard'],
    queryFn: async () => {
      try { const r = await nestClient.get('/nurse/dashboard'); return r.data; }
      catch { return { patients: [], assignedPatients: [], sharedNotes: [], unreadCount: 0 }; }
    },
    refetchInterval: 30000,
  });

  const patients = useMemo(() => {
    const list = nurseData?.patients || nurseData?.assignedPatients || [];
    const q = debounced.trim().toLowerCase();
    const filtered = q
      ? list.filter((p: any) => `${p.fname} ${p.lname}`.toLowerCase().includes(q))
      : list;
    return filtered
      .map((p: any) => ({ ...p, risk: assessPatient(toSnapshot(p), p.acuity_level) }))
      .sort((a: any, b: any) => riskRank(b.risk.level) - riskRank(a.risk.level));
  }, [nurseData, debounced]);

  const criticalCount = patients.filter((p: any) => p.risk.level === 'Critical').length;
  const highCount = patients.filter((p: any) => p.risk.level === 'High').length;
  const unreadCount = nurseData?.unreadCount || 0;

  const pid = selectedPatient?.pid ?? null;

  // ── Patient detail queries ─────────────────────────────────────────────
  const { data: vitalsHistory = [] } = useQuery({
    queryKey: ['vitals', pid],
    queryFn: async () => (pid ? (await nestClient.get(`/patients/${pid}/vitals`)).data : []),
    enabled: !!pid,
  });
  const { data: medications = [] } = useQuery({
    queryKey: ['medications', pid],
    queryFn: async () => (pid ? (await nestClient.get(`/patients/${pid}/medications`)).data : []),
    enabled: !!pid,
  });
  const { data: allergies = [] } = useQuery({
    queryKey: ['allergies', pid],
    queryFn: async () => (pid ? (await nestClient.get(`/patients/${pid}/allergies`)).data : []),
    enabled: !!pid,
  });
  const { data: carePlan = [] } = useQuery({
    queryKey: ['care-plan', pid],
    queryFn: async () => (pid ? (await nestClient.get(`/patients/${pid}/care-plan`)).data : []),
    enabled: !!pid,
  });
  const { data: notes = [] } = useQuery({
    queryKey: ['patient', pid, 'notes'],
    queryFn: async () => (pid ? (await nestClient.get(`/patients/${pid}/notes`)).data : []),
    enabled: !!pid,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['nurse-dashboard'] });
    qc.invalidateQueries({ queryKey: ['vitals', pid] });
    qc.invalidateQueries({ queryKey: ['medications', pid] });
    qc.invalidateQueries({ queryKey: ['allergies', pid] });
    qc.invalidateQueries({ queryKey: ['care-plan', pid] });
    qc.invalidateQueries({ queryKey: ['patient', pid, 'notes'] });
  };

  // ── Mutations ──────────────────────────────────────────────────────────
  const addCarePlan = useMutation({
    mutationFn: (d: any) => nestClient.post(`/patients/${pid}/care-plan`, d),
    onSuccess: () => { invalidate(); setPlanForm({ description: '', care_plan_type: 'nursing' }); },
  });
  const addNote = useMutation({
    mutationFn: (d: any) => nestClient.post(`/patients/${pid}/notes`, { title: d.title || 'RN Note', note: d.note, noteType: 'nurse', shareWithNursing: true }),
    onSuccess: () => { invalidate(); setNoteForm({ title: '', note: '' }); },
  });
  const markAllRead = useMutation({
    mutationFn: () => nestClient.post('/nurse/notes/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nurse-dashboard'] }),
  });

  const fmtDate = (d: string | null | undefined) => formatDateTime(d);

  return (
    <div className="glass-page position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #dbeafe 0%, #f5faff 45%, #d1fae5 100%)', borderRadius: '20px', minHeight: '100vh', padding: '16px' }}>
      <div className="position-absolute rounded-circle" style={{ width: '340px', height: '340px', top: '-80px', right: '-60px', background: 'radial-gradient(circle, rgba(13,110,253,0.30), transparent 70%)', filter: 'blur(20px)', zIndex: 0 }}></div>
      <div className="position-absolute rounded-circle" style={{ width: '400px', height: '400px', bottom: '8%', left: '-120px', background: 'radial-gradient(circle, rgba(0,201,167,0.30), transparent 70%)', filter: 'blur(20px)', zIndex: 0 }}></div>
      <style>{`
        .glass-page .card {
          position: relative;
          z-index: 1;
          background: rgba(255,255,255,0.60) !important;
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.9) !important;
          box-shadow: 0 22px 45px rgba(10,37,64,0.20), 0 6px 14px rgba(10,37,64,0.10) !important;
          transition: transform .25s ease, box-shadow .25s ease, background .25s ease;
        }
        .glass-page .card:hover {
          transform: translateY(-5px);
          background: rgba(255,255,255,0.70) !important;
          box-shadow: 0 30px 60px rgba(10,37,64,0.28), 0 10px 20px rgba(10,37,64,0.14) !important;
        }
        .glass-page .card .card-header,
        .glass-page .card-header {
          background: rgba(255,255,255,0.35) !important;
          border-bottom: 1px solid rgba(255,255,255,0.6) !important;
        }
        .glass-page .table thead.table-light {
          background: rgba(255,255,255,0.35) !important;
        }
      `}</style>

      {/* Header */}
      <div className="rounded-4 p-4 mb-4 text-white" style={{ background: 'linear-gradient(135deg, #6f42c1 0%, #0d6efd 55%, #20c997 100%)' }}>
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
          <div>
            <h2 className="mb-1 fw-bold"><i className="bi bi-clipboard2-pulse me-2"></i>Registered Nurse (RN) Dashboard</h2>
            <p className="mb-0 text-white text-opacity-75 small">
              Welcome, {user?.displayName || 'RN'} — Assessments, medication administration & care coordination
            </p>
          </div>
          <div className="d-flex gap-2">
            {unreadCount > 0 && (
              <button className="btn btn-light btn-sm rounded-pill" onClick={() => markAllRead.mutate()}>
                <i className="bi bi-envelope-open me-1"></i>Mark {unreadCount} note{unreadCount !== 1 ? 's' : ''} read
              </button>
            )}
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="row g-3 mb-4">
        {[
          { label: 'Patients on Dashboard', value: patients.length, icon: 'bi-people-fill', color: '#0d6efd' },
          { label: 'Critical', value: criticalCount, icon: 'bi-exclamation-octagon-fill', color: '#dc3545' },
          { label: 'High Risk', value: highCount, icon: 'bi-exclamation-triangle-fill', color: '#fd7e14' },
          { label: 'Unread Notes', value: unreadCount, icon: 'bi-envelope-fill', color: '#6f42c1' },
        ].map((k, i) => (
          <div className="col-md-3" key={i}>
            <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
              <div className="card-body d-flex align-items-center gap-3">
                <div className="rounded-circle d-flex align-items-center justify-content-center" style={{ width: '46px', height: '46px', backgroundColor: k.color + '18' }}>
                  <i className={`bi ${k.icon} fs-5`} style={{ color: k.color }}></i>
                </div>
                <div><div className="fw-bold fs-5" style={{ color: k.color }}>{k.value}</div><small className="text-muted">{k.label}</small></div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row g-3">
        {/* Patient list */}
        <div className="col-md-4">
          <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white py-2 d-flex align-items-center justify-content-between">
              <h6 className="mb-0 fw-bold small">Patients</h6>
              <span className="badge bg-primary rounded-pill">{patients.length}</span>
            </div>
            <div className="card-body p-2">
              <input className="form-control form-control-sm mb-2" placeholder="Search patients…" value={search} onChange={e => setSearch(e.target.value)} />
              <div style={{ maxHeight: '65vh', overflowY: 'auto' }}>
                {patients.length === 0 ? (
                  <div className="text-center text-muted py-4 small">No patients.</div>
                ) : (
                  patients.map((p: any) => (
                    <button key={p.pid}
                      className={`btn w-100 text-start mb-1 rounded-3 ${selectedPatient?.pid === p.pid ? 'btn-primary' : 'btn-light border'}`}
                      onClick={() => setSelectedPatient(p)}>
                      <div className="d-flex justify-content-between align-items-center">
                        <span className="fw-semibold small">{formatPatientName(p)}</span>
                        <span className={`badge rounded-pill ${riskBadge(p.risk.level)}`}>{p.risk.level}</span>
                      </div>
                      <div className="text-muted" style={{ fontSize: '0.7rem' }}>Room {p.room || '—'} · NEWS2 {p.risk.total ?? '—'}</div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Detail */}
        <div className="col-md-8">
          {!selectedPatient ? (
            <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
              <div className="card-body d-flex align-items-center justify-content-center text-muted" style={{ minHeight: '300px' }}>
                <div className="text-center"><i className="bi bi-person-badge fs-1 d-block mb-2"></i>Select a patient to view assessments and documentation.</div>
              </div>
            </div>
          ) : (
            <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
              <div className="card-header bg-white py-2">
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                  <h6 className="mb-0 fw-bold">{formatPatientName(selectedPatient)}</h6>
                  <div className="d-flex gap-1">
                    {[
                      ['vitals', 'Vitals', 'bi-heart-pulse'],
                      ['meds', 'Medications', 'bi-capsule'],
                      ['plan', 'Care Plan', 'bi-clipboard-check'],
                      ['notes', 'Notes', 'bi-journal-text'],
                    ].map(([id, label, icon]) => (
                      <button key={id} className={`btn btn-sm rounded-pill ${tab === id ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setTab(id)}>
                        <i className={`bi ${icon} me-1`}></i>{label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="card-body">
                {/* Vitals (read-only — patient vitals are recorded on the Nurse Aide dashboard) */}
                {tab === 'vitals' && (
                  <div className="card border-0 shadow-sm" style={{ borderRadius: '16px', maxHeight: '520px', overflowY: 'auto' }}>
                    <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Vital History</h6></div>
                    <div className="card-body p-0">
                      {vitalsHistory.length === 0 ? (
                        <div className="text-center text-muted py-4 small">No vitals recorded.</div>
                      ) : (
                        <table className="table table-sm table-hover mb-0 small">
                          <thead className="table-light"><tr><th>Time</th><th>BP</th><th>Pulse</th><th>Temp</th><th>SpO₂</th><th>NEWS2</th></tr></thead>
                          <tbody>
                            {vitalsHistory.map((v: any) => (
                              <tr key={v.id}>
                                <td>{fmtDate(v.date)}</td>
                                <td>
                                  {formatBP(v.bps, v.bpd)}{' '}
                                  {(() => {
                                    const bp = classifyBP(v.bps, v.bpd);
                                    return bp.category !== 'Normal' && bp.category !== '—'
                                      ? <span className="badge" style={{ backgroundColor: bp.color, color: '#fff' }}>{bp.category}</span>
                                      : null;
                                  })()}
                                </td>
                                <td>{formatVital(v.pulse)}</td>
                                <td>{formatVital(v.temperature, 1)}</td>
                                <td>{formatVital(v.oxygen_saturation)}</td>
                                <td>{computeNEWS2(toSnapshot(v)).total}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                )}

                {/* Medications */}
                {tab === 'meds' && (
                  <div className="row g-3">
                    <div className="col-md-7">
                      <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
                        <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Medication Administration Record (MAR)</h6></div>
                        <div className="card-body p-0">
                          {medications.length === 0 ? (
                            <div className="text-center text-muted py-4 small">No medications recorded.</div>
                          ) : (
                            <table className="table table-sm table-hover mb-0 small">
                              <thead className="table-light"><tr><th>Drug</th><th>Dosage</th><th>Route</th><th>Note</th></tr></thead>
                              <tbody>
                                {medications.map((m: any) => (
                                  <tr key={m.id}><td>{m.drug}</td><td>{m.dosage || '—'}</td><td>{m.route || '—'}</td><td>{m.note || '—'}</td></tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="col-md-5">
                      <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
                        <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Allergies</h6></div>
                        <div className="card-body">
                          {allergies.length === 0 ? (
                            <div className="text-muted small">No known allergies.</div>
                          ) : (
                            allergies.map((a: any) => (
                              <span key={a.id} className="badge bg-danger bg-opacity-10 text-danger border me-1 mb-1">{a.allergen || a.title}</span>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Care Plan */}
                {tab === 'plan' && (
                  <div className="row g-3">
                    <div className="col-md-5">
                      <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
                        <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Add Care Plan Entry</h6></div>
                        <div className="card-body">
                          <label className="form-label small mb-0">Plan</label>
                          <textarea className="form-control form-control-sm" rows={3} placeholder="e.g., Monitor SpO₂ every 2 hours…" value={planForm.description} onChange={e => setPlanForm({ ...planForm, description: e.target.value })} />
                          <label className="form-label small mt-2 mb-0">Type</label>
                          <select className="form-select form-select-sm" value={planForm.care_plan_type} onChange={e => setPlanForm({ ...planForm, care_plan_type: e.target.value })}>
                            <option value="nursing">Nursing</option><option value="dietary">Dietary</option><option value="mobility">Mobility</option><option value="discharge">Discharge</option>
                          </select>
                          <button className="btn btn-primary btn-sm rounded-pill w-100 mt-3" onClick={() => addCarePlan.mutate(planForm)} disabled={!planForm.description || addCarePlan.isPending}>
                            {addCarePlan.isPending ? 'Adding…' : <><i className="bi bi-plus-lg me-1"></i>Add to Plan</>}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="col-md-7">
                      <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
                        <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Care Plan</h6></div>
                        <div className="card-body p-0">
                          {carePlan.length === 0 ? (
                            <div className="text-center text-muted py-4 small">No care plan entries.</div>
                          ) : (
                            <div className="list-group list-group-flush">
                              {carePlan.map((c: any) => (
                                <div className="list-group-item" key={c.id}>
                                  <div className="d-flex justify-content-between">
                                    <span className="fw-semibold small">{c.description}</span>
                                    <span className="badge bg-light text-dark border small">{c.care_plan_type}</span>
                                  </div>
                                  <div className="text-muted" style={{ fontSize: '0.72rem' }}>{fmtDate(c.date)} · {c.plan_status}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Notes */}
                {tab === 'notes' && (
                  <div className="row g-3">
                    <div className="col-md-5">
                      <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
                        <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Add RN Note</h6></div>
                        <div className="card-body">
                          <input className="form-control form-control-sm mb-2" placeholder="Title" value={noteForm.title} onChange={e => setNoteForm({ ...noteForm, title: e.target.value })} />
                          <textarea className="form-control form-control-sm" rows={4} placeholder="RN assessment…" value={noteForm.note} onChange={e => setNoteForm({ ...noteForm, note: e.target.value })} />
                          <button className="btn btn-primary btn-sm rounded-pill w-100 mt-2" onClick={() => addNote.mutate(noteForm)} disabled={!noteForm.note || addNote.isPending}>
                            {addNote.isPending ? 'Saving…' : <><i className="bi bi-journal-plus me-1"></i>Add RN Note</>}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="col-md-7">
                      <div className="card border-0 shadow-sm" style={{ borderRadius: '16px', maxHeight: '480px', overflowY: 'auto' }}>
                        <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small">Clinical Notes</h6></div>
                        <div className="card-body p-0">
                          {notes.length === 0 ? (
                            <div className="text-center text-muted py-4 small">No notes.</div>
                          ) : (
                            <div className="list-group list-group-flush">
                              {notes.map((n: any) => (
                                <div className="list-group-item" key={n.id}>
                                  <div className="d-flex justify-content-between">
                                    <span className="fw-semibold small">{n.title || 'Note'}</span>
                                    <span className="text-muted" style={{ fontSize: '0.7rem' }}>{fmtDate(n.date)}</span>
                                  </div>
                                  <div className="small text-muted">{n.body}</div>
                                  <div className="text-muted" style={{ fontSize: '0.7rem' }}>By {n.author_name || n.user || '—'}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
