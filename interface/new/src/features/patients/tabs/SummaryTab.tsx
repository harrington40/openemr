import { useState } from 'react';
import type { Patient } from '../../../types/patient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../../api/nest-client';
import { useAuth } from '../../../hooks/useAuth';
import { formatVital, formatVitalUnit, formatBP, classifyBP, classifyPulse, classifyTemp, classifyResp, classifySpO2 } from '../../../utils/vitalsClassify';
import { formatPatientName } from '../../../utils/patientName';
import { formatDateOnly, formatDateHuman } from '../../../utils/date';

interface Props {
  patient: Patient;
  patientId: string;
  patientName: string;
  allergies: any[];
  allergiesEnriched?: any[];
  medications: any[];
  conditions: any[];
  vitals: any[];
  notes?: any[];
  labOrders?: any[];
  labResults?: any[];
  onViewTrend: () => void;
}

const ROS_SYSTEMS: { key: string; label: string; words: string[] }[] = [
  { key: 'constitutional', label: 'Constitutional', words: ['fever', 'fatigue', 'chills', 'weight'] },
  { key: 'respiratory', label: 'Respiratory', words: ['cough', 'shortness of breath', 'dyspnea', 'wheeze'] },
  { key: 'cardiovascular', label: 'Cardiovascular', words: ['chest pain', 'palpitations', 'edema'] },
  { key: 'gi', label: 'GI', words: ['nausea', 'vomiting', 'abdominal', 'diarrhea'] },
  { key: 'gu', label: 'GU', words: ['dysuria', 'urinary', 'hematuria'] },
  { key: 'neuro', label: 'Neuro', words: ['headache', 'dizziness', 'numbness', 'weakness'] },
  { key: 'msk', label: 'MSK', words: ['joint', 'back pain', 'muscle'] },
  { key: 'skin', label: 'Skin', words: ['rash', 'lesion', 'itching'] },
  { key: 'psych', label: 'Psych', words: ['anxiety', 'depression', 'mood'] },
  { key: 'heent', label: 'HEENT', words: ['sore throat', 'ear pain', 'vision'] },
];

export default function SummaryTab({
  patient,
  patientId,
  patientName,
  allergies = [],
  allergiesEnriched = [],
  medications = [],
  conditions = [],
  vitals = [],
  notes = [],
  labOrders = [],
  labResults = [],
  onViewTrend,
}: Props) {
  const p = patient as any;
  const dobRaw = p.DOB || p.dob;
  const age = dobRaw
    ? Math.floor((Date.now() - new Date(dobRaw).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null;
  const phone = p.phone_contact || p.phone || '—';
  const attending = p.providerName || p.provider_name || '—';
  const codeStatus = p.code_status || 'Full Code';

  const { data: attendingHistory = [] } = useQuery({
    queryKey: ['attending-history', patientId],
    queryFn: async () => {
      if (!patientId) return [];
      try { const r = await nestClient.get(`/patients/${patientId}/attending-history`); return r.data || []; } catch { return []; }
    },
    enabled: !!patientId,
  });

  const latest = vitals?.[0];
  const prev = vitals?.[1];
  const latestNote = notes?.[0];

  // ── Authorized deletion of a verified lab result (admin + 4-digit code) ──
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'admin';
  // Verified results can only be removed with a code: admins use the master
  // code, while lab staff and providers use a one-time code an admin issued.
  const canDeleteLabs = ['admin', 'lab_tech', 'physician'].includes(user?.role || '');
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleteCode, setDeleteCode] = useState('');
  const [deleteError, setDeleteError] = useState('');

  const deleteLabResult = useMutation({
    mutationFn: ({ id, code }: { id: number; code: string }) =>
      nestClient.post(`/lab/results/${id}/authorized-delete`, { code }),
    onSuccess: () => {
      // Refresh the chart's lab-results query (keyed by the route id, which may
      // differ from pid) without touching every other patient query.
      queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) && q.queryKey[q.queryKey.length - 1] === 'lab-results',
      });
      setDeleteTarget(null);
      setDeleteCode('');
      setDeleteError('');
    },
    onError: (e: any) => {
      setDeleteError(e?.response?.data?.message || 'Invalid authorization code. Please try again.');
    },
  });

  // Fall back to the most recent reading that actually contains each value,
  // since a single vitals entry may not capture weight/height.
  const pickVital = (key: string) => (vitals || []).find((v: any) => v?.[key] != null && v?.[key] !== '')?.[key];
  const weight = formatVital(pickVital('weight'), 1);
  const height = formatVital(pickVital('height'), 1);
  const bmi = formatVital(pickVital('BMI'), 1);
  const bmiVal = Number(pickVital('BMI'));
  const bmiColor = !isFinite(bmiVal) || bmiVal === 0 ? '#6c757d' : (bmiVal < 18.5 || bmiVal >= 30 ? '#dc3545' : bmiVal >= 25 ? '#fd7e14' : '#198754');
  const bpText = latest ? formatBP(latest.bps, latest.bpd) : '—';
  const pulseText = formatVital(latest?.pulse);
  const tempText = latest?.temperature ? `${formatVital(latest.temperature, 1)} °C` : '—';
  const respText = formatVital(latest?.respiration);
  const spo2Text = latest?.oxygen_saturation ? `${formatVital(latest.oxygen_saturation)}%` : '—';

  // ── Needs Attention flags ─────────────────────────────────────────
  const flags: { icon: string; color: string; text: string }[] = [];
  const bpHigh = latest && (Number(latest.bps) >= 140 || Number(latest.bpd) >= 90);
  if (bpHigh) flags.push({ icon: 'bi-heart-pulse', color: 'danger', text: `Elevated BP (${formatBP(latest.bps, latest.bpd)}) — latest reading` });
  if (latest && Number(latest.oxygen_saturation) > 0 && Number(latest.oxygen_saturation) < 94) {
    flags.push({ icon: 'bi-lungs', color: 'danger', text: `Low SpO₂ (${formatVital(latest.oxygen_saturation)}%) — latest reading` });
  }
  const allergySource = (allergiesEnriched && allergiesEnriched.length) ? allergiesEnriched : allergies;
  const allergyNames = allergySource.map((a: any) => String(a.allergen || a.title || '').toLowerCase()).filter(Boolean);
  const drugAllergy = medications.filter((m: any) => {
    const d = String(m.drug || '').toLowerCase();
    return allergyNames.some((a) => d.includes(a));
  });
  drugAllergy.forEach((m: any) => flags.push({ icon: 'bi-capsule', color: 'danger', text: `Drug-allergy interaction: ${m.drug}` }));
  if (medications.length >= 5) flags.push({ icon: 'bi-capsule-pill', color: 'warning', text: `Polypharmacy: ${medications.length} active medications` });

  // ── Smart clinical summary ────────────────────────────────────────
  const insights: string[] = [];
  if (latest && prev && Number(latest.bps) > Number(prev.bps)) insights.push("Patient's BP trend has been increasing over the last readings.");
  if (allergyNames.length && drugAllergy.length === 0) insights.push('No medication allergy conflicts with current orders.');
  insights.push(`Active medications: ${medications.length} · Allergies: ${allergies.length} · Diagnoses: ${conditions.length}`);

  // ── ROS detection from notes ──────────────────────────────────────
  const noteText = notes.map((n: any) => `${n.title || ''} ${n.body || ''}`).join(' ').toLowerCase();
  const conditionText = conditions.map((c: any) => c.title || c.name || c.diagnosis || '').join(' ').toLowerCase();
  const haystack = `${noteText} ${conditionText}`;

  return (
    <div className="medical-record">
      {/* Facility header */}
      <div className="text-center mb-3">
        <h5 className="fw-bold mb-0">Ma Juan Memorial Hospital Clinic</h5>
        <div className="text-uppercase fw-bold" style={{ letterSpacing: '1px', fontSize: '0.8rem' }}>Patient Medical Record</div>
        <small className="text-muted">Confidential — For Authorized Use Only · Care Today, Healthier Tomorrow</small>
      </div>

      {/* Demographics banner */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px', borderLeft: '4px solid #0d6efd' }}>
        <div className="card-body py-3">
          <div className="row g-2 small">
            <div className="col-md-6">
              <div className="fw-bold fs-6">{patientName || formatPatientName(patient)}</div>
              <div className="text-muted">DOB: {formatDateOnly(dobRaw)} {age != null ? `(${age} y/o)` : ''} · {patient.sex || '—'}</div>
              <div className="text-muted">PID: {patient.pid ?? '—'} · Chart #: {patient.public_id || '—'}</div>
            </div>
            <div className="col-md-6">
              <div><span className="text-muted">Attending:</span> {attending}</div>
              <div><span className="text-muted">Phone:</span> {phone}</div>
              <div><span className="text-muted">Code Status:</span> {codeStatus}</div>
            </div>
          </div>
          <div className="row g-2 small mt-2 border-top pt-2">
            <div className="col-6 col-md-3"><span className="text-muted d-block">Blood Pressure</span><b style={{ color: latest ? classifyBP(latest.bps, latest.bpd).color : undefined }}>{bpText}</b></div>
            <div className="col-6 col-md-2"><span className="text-muted d-block">Pulse</span><b style={{ color: latest ? classifyPulse(latest.pulse).color : undefined }}>{pulseText}</b></div>
            <div className="col-6 col-md-2"><span className="text-muted d-block">Temp</span><b style={{ color: latest ? classifyTemp(latest.temperature).color : undefined }}>{tempText}</b></div>
            <div className="col-6 col-md-2"><span className="text-muted d-block">Resp</span><b style={{ color: latest ? classifyResp(latest.respiration).color : undefined }}>{respText}</b></div>
            <div className="col-6 col-md-3"><span className="text-muted d-block">SpO₂</span><b style={{ color: latest ? classifySpO2(latest.oxygen_saturation).color : undefined }}>{spo2Text}</b></div>
          </div>
          <div className="row g-2 small mt-2 border-top pt-2">
            <div className="col-4 col-md-3"><span className="text-muted d-block">Weight</span><b style={{ color: '#198754' }}>{weight} kg</b></div>
            <div className="col-4 col-md-3"><span className="text-muted d-block">Height</span><b style={{ color: '#0d6efd' }}>{height} cm</b></div>
            <div className="col-4 col-md-3"><span className="text-muted d-block">BMI</span><b style={{ color: bmiColor }}>{bmi}</b></div>
            <div className="col-12 col-md-3">
              <span className="text-muted d-block">Allergies</span>
              {allergySource.length ? (
                allergySource.map((a: any, i: number) => (
                  <span key={i} className="badge bg-danger bg-opacity-10 text-danger me-1" title={a.source && a.source !== 'recorded' ? `Population source: ${a.source}` : undefined}>
                    {a.allergen || a.title}
                    {a.source && a.source !== 'recorded' && <i className={`bi ms-1 ${a.source === 'note' ? 'bi-journal-text' : 'bi-capsule'}`}></i>}
                  </span>
                ))
              ) : (
                <b className="text-muted">No known allergies</b>
              )}
            </div>
          </div>
          {attendingHistory.length > 0 && (
            <div className="mt-2 border-top pt-2">
              <div className="text-muted small mb-1"><i className="bi bi-clock-history me-1"></i>Attending History</div>
              <div className="d-flex flex-wrap gap-2">
                {(attendingHistory as any[]).map((a: any, i: number) => (
                  <span key={i} className="badge bg-light text-dark border" style={{ fontWeight: 500 }}>
                    {a.name}{a.role ? ` · ${a.role}` : ''}{a.last_seen ? ` · ${formatDateHuman(a.last_seen)}` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Needs attention */}
      {flags.length > 0 && (
        <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px', borderLeft: '4px solid #dc3545' }}>
          <div className="card-body py-2 px-3">
            <div className="fw-bold small mb-1"><i className="bi bi-exclamation-triangle text-danger me-1"></i>Needs Attention</div>
            {flags.map((f, i) => (
              <div key={i} className="small mb-1"><i className={`bi ${f.icon} text-${f.color} me-1`}></i>{f.text}</div>
            ))}
          </div>
        </div>
      )}

      {/* Chief complaint + HPI */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
        <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold"><i className="bi bi-chat-left-text me-2 text-primary"></i>Chief Complaint & History of Present Illness</h6></div>
        <div className="card-body py-2 small">
          <div className="fw-semibold mb-1">{latestNote?.title || '—'}</div>
          <div className="text-muted" style={{ whiteSpace: 'pre-wrap' }}>{(latestNote?.body || 'No narrative recorded').slice(0, 500)}</div>
        </div>
      </div>

      {/* Smart clinical summary */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px', borderLeft: '4px solid #6f42c1' }}>
        <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold"><i className="bi bi-stars me-2 text-primary"></i>Smart Clinical Summary</h6></div>
        <div className="card-body py-2">
          <ul className="mb-0 small ps-3">
            {insights.map((s, i) => <li key={i} className="mb-1">{s}</li>)}
          </ul>
        </div>
      </div>

      {/* Clinical history grid */}
      <div className="row g-3">
        <div className="col-md-6">
          <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold"><i className="bi bi-clipboard2-pulse me-2 text-info"></i>Past Medical History</h6></div>
            <div className="card-body py-2">
              {conditions.length ? conditions.map((c: any, i: number) => (
                <div key={i} className="small mb-1">• {c.title || c.name || c.diagnosis || c.code || '—'}</div>
              )) : <div className="small text-muted">No diagnoses recorded</div>}
            </div>
          </div>
        </div>
        <div className="col-md-6">
          <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold"><i className="bi bi-scissors me-2 text-secondary"></i>Past Surgical / Social / Family History</h6></div>
            <div className="card-body py-2 small">
              <div className="mb-2"><span className="text-muted">Surgical:</span> {latestNote ? '—' : '—'}</div>
              <div className="mb-2"><span className="text-muted">Social:</span> —</div>
              <div><span className="text-muted">Family:</span> —</div>
            </div>
          </div>
        </div>
      </div>

      {/* Review of systems */}
      <div className="card border-0 shadow-sm mt-3" style={{ borderRadius: '16px' }}>
        <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold"><i className="bi bi-list-check me-2 text-success"></i>Review of Systems</h6></div>
        <div className="card-body py-2">
          <div className="d-flex flex-wrap gap-2">
            {ROS_SYSTEMS.map((sys) => {
              const positive = sys.words.some((w) => haystack.includes(w));
              return (
                <span key={sys.key} className={`badge ${positive ? 'bg-warning bg-opacity-15 text-dark' : 'bg-light text-muted'} border`} style={{ fontSize: '0.72rem' }}>
                  {positive ? '+' : '−'} {sys.label}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Medications */}
      <div className="card border-0 shadow-sm mt-3" style={{ borderRadius: '16px' }}>
        <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold"><i className="bi bi-capsule me-2 text-primary"></i>Current Medications</h6></div>
        <div className="card-body p-0">
          {medications.length ? (
            <table className="table table-sm small mb-0">
              <thead className="table-light"><tr><th>Medication</th><th>Dose</th><th>Route</th></tr></thead>
              <tbody>
                {medications.map((m: any, i: number) => (
                  <tr key={i}><td className="fw-semibold">{m.drug}</td><td>{m.dosage || '—'}</td><td>{m.route || '—'}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center text-muted small py-3">No medications</div>
          )}
        </div>
      </div>

      {/* Vital signs */}
      <div className="card border-0 shadow-sm mt-3" style={{ borderRadius: '16px' }}>
        <div className="card-header bg-white py-2 d-flex justify-content-between align-items-center">
          <h6 className="mb-0 fw-bold"><i className="bi bi-heart-pulse me-2 text-danger"></i>Vital Signs (Last 24 hrs)</h6>
          <button className="btn btn-sm btn-outline-primary rounded-pill" onClick={onViewTrend}><i className="bi bi-graph-up me-1"></i>View Trend</button>
        </div>
        <div className="card-body p-0">
          {vitals.length ? (
            <table className="table table-sm small mb-0">
              <thead className="table-light"><tr><th>Date/Time</th><th>Temp °F</th><th>HR</th><th>BP</th><th>RR</th><th>SpO₂</th><th>Weight</th></tr></thead>
              <tbody>
                {vitals.slice(0, 5).map((v: any, i: number) => (
                  <tr key={i}>
                    <td className="text-nowrap">{v.date ? new Date(v.date).toLocaleString() : '—'}</td>
                    <td>{formatVitalUnit(v.temperature, 1, '°')}</td>
                    <td>{formatVital(v.pulse)}</td>
                    <td>{formatBP(v.bps, v.bpd)}</td>
                    <td>{formatVital(v.respiration)}</td>
                    <td>{formatVitalUnit(v.oxygen_saturation, 0, '%')}</td>
                    <td>{formatVitalUnit(v.weight, 1, ' kg')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center text-muted py-3 small">No vitals recorded</div>
          )}
        </div>
      </div>

      {/* Recent labs + active orders */}
      <div className="row g-3 mt-1">
        <div className="col-md-7">
          <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold"><i className="bi bi-droplet me-2 text-info"></i>Recent Lab Results</h6></div>
            <div className="card-body p-0">
              {labResults.length ? (
                <table className="table table-sm small mb-0">
                  <thead className="table-light"><tr><th>Test</th><th>Result</th><th>Units</th><th>Flag</th><th>Status</th><th>Date</th>{canDeleteLabs && <th className="text-end">Actions</th>}</tr></thead>
                  <tbody>
                    {labResults.slice(0, 6).map((r: any, i: number) => (
                      <tr key={i}>
                        <td className="fw-semibold">{r.test_name || r.result_code}</td>
                        <td>{r.result ?? '—'}</td>
                        <td>{r.units || '—'}</td>
                        <td>{r.abnormal && r.abnormal !== 'N' ? <span className="badge bg-danger">Abn</span> : <span className="text-muted">—</span>}</td>
                        <td>
                          {r.order_status === 'validated'
                            ? <span className="badge bg-primary">Validated</span>
                            : r.order_status
                              ? <span className="badge bg-light text-dark border">{r.order_status}</span>
                              : <span className="text-muted">—</span>}
                        </td>
                        <td className="text-nowrap">{r.result_date ? new Date(r.result_date).toLocaleDateString() : '—'}</td>
                        {canDeleteLabs && (
                          <td className="text-end">
                            {(r.order_status === 'validated' || r.review_status === 'reviewed') && (
                              <button
                                className="btn btn-sm btn-outline-danger py-0 px-1"
                                title={isAdmin ? 'Delete verified lab result (admin authorization code required)' : 'Delete verified lab result (enter the code an administrator sent you)'}
                                onClick={() => { setDeleteTarget(r); setDeleteCode(''); setDeleteError(''); }}>
                                <i className="bi bi-trash"></i>
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-center text-muted small py-3">No lab results</div>
              )}

              {canDeleteLabs && deleteTarget && (
                <div className="p-3 border-top bg-light">
                  <div className="fw-bold small mb-1">
                    <i className="bi bi-shield-lock me-1 text-danger"></i>
                    {isAdmin ? 'Administrator authorization required' : 'Authorization code required'}
                  </div>
                  <p className="text-muted small mb-2">
                    Delete <strong>{deleteTarget.test_name || deleteTarget.result_code}</strong>
                    {deleteTarget.result ? ` (${deleteTarget.result})` : ''} from {patientName}&apos;s chart?
                    This permanently removes a verified result and cannot be undone.
                    {!isAdmin && ' Enter the one-time code an administrator sent you.'}
                  </p>
                  <div className="d-flex gap-2 align-items-center flex-wrap">
                    <input
                      className="form-control form-control-sm"
                      style={{ maxWidth: '130px' }}
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={4}
                      placeholder="4-digit code"
                      value={deleteCode}
                      onChange={(e) => { setDeleteCode(e.target.value.replace(/\D/g, '').slice(0, 4)); setDeleteError(''); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && deleteCode.length === 4) {
                          deleteLabResult.mutate({ id: deleteTarget.id, code: deleteCode });
                        }
                      }}
                    />
                    <button
                      className="btn btn-danger btn-sm rounded-pill"
                      disabled={deleteCode.length !== 4 || deleteLabResult.isPending}
                      onClick={() => deleteLabResult.mutate({ id: deleteTarget.id, code: deleteCode })}>
                      {deleteLabResult.isPending ? 'Deleting…' : 'Delete lab result'}
                    </button>
                    <button
                      className="btn btn-outline-secondary btn-sm rounded-pill"
                      disabled={deleteLabResult.isPending}
                      onClick={() => { setDeleteTarget(null); setDeleteCode(''); setDeleteError(''); }}>
                      Cancel
                    </button>
                  </div>
                  {deleteError && (
                    <div className="text-danger small mt-2">
                      <i className="bi bi-exclamation-triangle me-1"></i>{deleteError}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="col-md-5">
          <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold"><i className="bi bi-card-checklist me-2 text-success"></i>Active Orders</h6></div>
            <div className="card-body p-0">
              {labOrders.length ? (
                <table className="table table-sm small mb-0">
                  <thead className="table-light"><tr><th>Order</th><th>Status</th></tr></thead>
                  <tbody>
                    {labOrders.slice(0, 6).map((o: any, i: number) => (
                      <tr key={i}>
                        <td className="fw-semibold">{o.instructions || 'Lab test'}</td>
                        <td><span className="badge bg-light text-dark border">{o.orderStatus || 'pending'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-center text-muted small py-3">No active orders</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
