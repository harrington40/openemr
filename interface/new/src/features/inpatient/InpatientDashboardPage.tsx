import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import nestClient from '../../api/nest-client';
import { formatPatientName } from '../../utils/patientName';
import { formatVital, formatBP } from '../../utils/vitalsClassify';
import { chartPatientId } from '../../utils/patientChart';

interface BedDef { id: string; label: string; }
interface WardDef { id: string; name: string; floor: string; beds: BedDef[]; }

const WARD_LAYOUT: WardDef[] = [
  { id: 'ward-a', name: 'General Ward A', floor: '1st Floor', beds: ['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7', 'A-8'].map(l => ({ id: l.toLowerCase(), label: l })) },
  { id: 'ward-b', name: 'Maternity Ward', floor: '2nd Floor', beds: ['B-1', 'B-2', 'B-3', 'B-4', 'B-5', 'B-6'].map(l => ({ id: l.toLowerCase(), label: l })) },
  { id: 'ward-icu', name: 'Intensive Care Unit', floor: '3rd Floor', beds: ['ICU-1', 'ICU-2', 'ICU-3', 'ICU-4'].map(l => ({ id: l.toLowerCase(), label: l })) },
  { id: 'ward-peds', name: 'Pediatric Ward', floor: '2nd Floor', beds: ['P-1', 'P-2', 'P-3', 'P-4'].map(l => ({ id: l.toLowerCase(), label: l })) },
  { id: 'ward-surg', name: 'Surgical Ward', floor: '1st Floor', beds: ['S-1', 'S-2', 'S-3', 'S-4'].map(l => ({ id: l.toLowerCase(), label: l })) },
];

function losInfo(days: number | null): { days: number; label: string; color: string } {
  if (days == null) return { days: 0, label: 'N/A', color: '#6c757d' };
  if (days <= 0) return { days, label: 'Admitted today', color: '#0dcaf0' };
  if (days <= 3) return { days, label: `${days} day${days > 1 ? 's' : ''}`, color: '#198754' };
  if (days <= 7) return { days, label: `${days} days`, color: '#fd7e14' };
  return { days, label: `${days} days`, color: '#dc3545' };
}

const riskColor = (level?: string) => (level === 'high' ? '#dc3545' : level === 'medium' ? '#fd7e14' : '#198754');
const riskBadge = (level?: string) => (level === 'high' ? 'bg-danger' : level === 'medium' ? 'bg-warning text-dark' : 'bg-success');

export default function InpatientDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canWrite = ['admin', 'physician', 'nurse'].includes(user?.role || '');

  const [selectedWard, setSelectedWard] = useState('ward-a');
  const [showAdmit, setShowAdmit] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showDischarge, setShowDischarge] = useState(false);
  const [showPatientDetail, setShowPatientDetail] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [admitForm, setAdmitForm] = useState({ pid: '', search: '' });
  const [transferForm, setTransferForm] = useState({ toWard: '', toBed: '' });
  const [toast, setToast] = useState('');

  // ── Smart live census (real inpatients + NEWS2 risk + capacity) ──────────
  const { data: overview, isLoading } = useQuery({
    queryKey: ['inpatient-overview'],
    queryFn: async () => { const r = await nestClient.get('/inpatient/overview'); return r.data; },
    refetchInterval: 15000,
  });

  const inpatients: any[] = overview?.inpatients || [];
  const summary = overview?.summary || { total: 0, highRisk: 0, staleVitals: 0, longStay: 0 };

  const { data: patients = [] } = useQuery({
    queryKey: ['inpatient-patient-search', admitForm.search],
    queryFn: async () => {
      if (admitForm.search.trim().length < 2) return [];
      const r = await nestClient.get('/patients', { params: { search: admitForm.search, limit: 20 } });
      return r.data;
    },
    enabled: admitForm.search.trim().length >= 2,
  });

  const occupantByRoom = useMemo(() => {
    const m: Record<string, any> = {};
    for (const ip of inpatients) {
      if (ip.room) m[String(ip.room).trim().toUpperCase()] = ip;
    }
    return m;
  }, [inpatients]);

  const occupantFor = (label: string) => occupantByRoom[label.trim().toUpperCase()];

  const currentWard = WARD_LAYOUT.find(w => w.id === selectedWard)!;
  const allBeds = WARD_LAYOUT.flatMap(w => w.beds);
  const occupiedCount = allBeds.filter(b => occupantFor(b.label)).length;
  const totalBeds = allBeds.length;
  const availability = totalBeds ? Math.round((occupiedCount / totalBeds) * 100) : 0;
  const unassigned = inpatients.filter(ip => !allBeds.some(b => b.label.toUpperCase() === String(ip.room || '').toUpperCase()));

  const activePatient = selectedRoom ? occupantFor(selectedRoom) : null;
  const activeLos = activePatient ? losInfo(activePatient.los_days) : null;

  const { data: activeMeds = [] } = useQuery({
    queryKey: ['inpatient-meds', activePatient?.pid],
    queryFn: async () => { const r = await nestClient.get(`/patients/${activePatient?.pid}/medications`); return r.data || []; },
    enabled: !!activePatient?.pid && showPatientDetail,
  });

  const setRoom = useMutation({
    mutationFn: ({ pid, room }: { pid: number; room: string }) => nestClient.patch(`/patients/${pid}/room`, { room }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inpatient-overview'] }); qc.invalidateQueries({ queryKey: ['nurse-dashboard'] }); },
    onError: (e: any) => setToast(e?.response?.data?.message || 'Could not update bed assignment'),
  });

  const handleAdmit = () => {
    if (!selectedRoom || !admitForm.pid) return;
    setRoom.mutate({ pid: Number(admitForm.pid), room: selectedRoom }, {
      onSuccess: () => { setToast(`Admitted to ${selectedRoom}`); setShowAdmit(false); setAdmitForm({ pid: '', search: '' }); setSelectedRoom(null); },
    });
  };

  const handleTransfer = () => {
    const target = WARD_LAYOUT.find(w => w.id === transferForm.toWard)?.beds.find(b => b.id === transferForm.toBed);
    if (!activePatient || !target) return;
    setRoom.mutate({ pid: activePatient.pid, room: target.label }, {
      onSuccess: () => { setToast(`Transferred to ${target.label}`); setShowTransfer(false); setTransferForm({ toWard: '', toBed: '' }); setSelectedRoom(null); },
    });
  };

  const handleDischarge = () => {
    if (!activePatient) return;
    setRoom.mutate({ pid: activePatient.pid, room: '' }, {
      onSuccess: () => { setToast(`${formatPatientName(activePatient)} discharged`); setShowDischarge(false); setShowPatientDetail(false); setSelectedRoom(null); },
    });
  };

  const handleBedClick = (label: string) => {
    setSelectedRoom(label);
    if (occupantFor(label)) setShowPatientDetail(true);
    else if (canWrite) setShowAdmit(true);
  };

  const targetWard = WARD_LAYOUT.find(w => w.id === transferForm.toWard);

  return (
    <div className="glass-page position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #dbeafe 0%, #f5faff 45%, #d1fae5 100%)', borderRadius: '20px', minHeight: '100vh', padding: '16px' }}>
      <style>{`
        .glass-page .card { position: relative; z-index: 1; background: rgba(255,255,255,0.60) !important; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.9) !important; box-shadow: 0 22px 45px rgba(10,37,64,0.20), 0 6px 14px rgba(10,37,64,0.10) !important; }
        .glass-page .card-header { background: rgba(255,255,255,0.35) !important; }
      `}</style>

      {toast && (
        <div className="alert alert-info py-2 small d-flex justify-content-between align-items-center position-relative" style={{ zIndex: 2 }}>
          <span><i className="bi bi-info-circle me-1"></i>{toast}</span>
          <button className="btn-close btn-sm" onClick={() => setToast('')}></button>
        </div>
      )}

      {/* Header */}
      <div className="rounded-4 p-4 mb-4 text-white position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0d6efd 0%, #198754 50%, #0dcaf0 100%)' }}>
        <div className="position-absolute end-0 top-0 opacity-10" style={{ fontSize: '7rem', transform: 'rotate(10deg) translate(20px,-10px)' }}><i className="bi bi-hospital"></i></div>
        <div className="position-relative">
          <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
            <div>
              <h2 className="mb-1 fw-bold"><i className="bi bi-hospital me-2"></i>Inpatient Management</h2>
              <p className="mb-0 text-white text-opacity-75 small">
                {canWrite ? 'Admission · Discharge · Transfer · Smart Ward Management' : 'Read-Only View — Ward Management'}
              </p>
            </div>
            <div className="d-flex gap-2 flex-wrap">
              {[
                { v: summary.total, l: 'Inpatients', c: '#fff' },
                { v: `${occupiedCount}/${totalBeds}`, l: 'Beds Occupied', c: '#ffc107' },
                { v: `${availability}%`, l: 'Occupancy', c: '#fd7e14' },
                { v: summary.highRisk, l: 'High Risk', c: '#dc3545' },
                { v: summary.longStay, l: 'Long Stay >7d', c: '#dc3545' },
              ].map(s => (
                <div key={s.l} className="text-center bg-white bg-opacity-15 rounded-3 px-3 py-2" style={{ minWidth: '66px' }}>
                  <div className="fw-bold fs-5 lh-1">{s.v}</div>
                  <small className="text-white text-opacity-75" style={{ fontSize: '0.6rem' }}>{s.l}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Smart insights */}
      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: '16px', borderLeft: '5px solid #6f42c1' }}>
        <div className="card-body py-3">
          <div className="fw-bold small mb-2"><i className="bi bi-cpu me-2 text-primary"></i>Smart Ward Insights</div>
          <div className="d-flex flex-wrap gap-2">
            {summary.highRisk > 0 && <span className="badge bg-danger bg-opacity-10 text-danger border"><i className="bi bi-exclamation-triangle me-1"></i>{summary.highRisk} high-risk patient{summary.highRisk > 1 ? 's' : ''} — prioritise review</span>}
            {summary.staleVitals > 0 && <span className="badge bg-warning bg-opacity-10 text-dark border"><i className="bi bi-clock-history me-1"></i>{summary.staleVitals} with vitals over 8h old — recheck due</span>}
            {summary.longStay > 0 && <span className="badge bg-info bg-opacity-10 text-dark border"><i className="bi bi-hourglass-split me-1"></i>{summary.longStay} long-stay (over 7 days) — review discharge plan</span>}
            {availability >= 85 && <span className="badge bg-danger bg-opacity-10 text-danger border"><i className="bi bi-building me-1"></i>High occupancy ({availability}%) — prepare overflow</span>}
            {summary.total === 0 && <span className="text-muted small">No patients currently assigned to a bed.</span>}
            {summary.highRisk === 0 && summary.staleVitals === 0 && summary.longStay === 0 && summary.total > 0 && (
              <span className="badge bg-success bg-opacity-10 text-success border"><i className="bi bi-check2-circle me-1"></i>Census stable — no alerts</span>
            )}
          </div>
        </div>
      </div>

      <div className="row g-3">
        {/* Ward Selector + Bed Grid */}
        <div className="col-lg-7">
          <div className="d-flex gap-2 mb-3 flex-wrap">
            {WARD_LAYOUT.map(w => (
              <button key={w.id} className={`btn rounded-pill ${selectedWard === w.id ? 'btn-primary' : 'btn-outline-primary'}`}
                onClick={() => setSelectedWard(w.id)}>
                <i className="bi bi-building me-1"></i>{w.name}
                <span className="badge bg-light text-dark ms-2">{w.beds.filter(b => occupantFor(b.label)).length}/{w.beds.length}</span>
              </button>
            ))}
          </div>

          <div className="card border-0 shadow-sm" style={{ borderRadius: '20px' }}>
            <div className="card-header bg-white py-3 d-flex justify-content-between" style={{ borderRadius: '20px 20px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-grid-3x3-gap me-2 text-primary"></i>{currentWard.name} — {currentWard.floor}</h6>
              <span className="badge bg-success rounded-pill">{currentWard.beds.filter(b => !occupantFor(b.label)).length} beds available</span>
            </div>
            <div className="card-body p-3">
              {isLoading ? (
                <div className="text-center py-5"><div className="spinner-border text-primary"></div></div>
              ) : (
                <div className="row g-3">
                  {currentWard.beds.map(bed => {
                    const occ = occupantFor(bed.label);
                    const risk = occ?.risk?.level;
                    const col = occ ? riskColor(risk) : '#dee2e6';
                    return (
                      <div className="col-md-3 col-sm-4 col-6" key={bed.id}>
                        <div className="card border-0 h-100" style={{ borderRadius: '16px', cursor: 'pointer', border: `2px solid ${col}`, background: occ ? `${col}12` : '#fff' }}
                          onClick={() => handleBedClick(bed.label)}>
                          <div className="card-body text-center py-4">
                            <i className={`bi ${occ ? 'bi-person-fill' : 'bi-plus-circle text-muted'}`} style={{ fontSize: '2rem', color: occ ? col : undefined }}></i>
                            <div className="fw-bold mt-1">{bed.label}</div>
                            {occ ? (
                              <div className="small">
                                <div className="fw-semibold" style={{ color: col }}>{formatPatientName(occ)}</div>
                                <span className={`badge rounded-pill mt-1 ${riskBadge(risk)}`} style={{ fontSize: '0.6rem' }}>NEWS2 {occ.risk?.score} · {risk}</span>
                              </div>
                            ) : (
                              <small className="text-success">Available</small>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {unassigned.length > 0 && (
            <div className="card border-0 shadow-sm mt-3" style={{ borderRadius: '16px' }}>
              <div className="card-header bg-white py-2"><h6 className="mb-0 fw-bold small"><i className="bi bi-exclamation-circle me-1 text-warning"></i>Assigned to a room not in this layout ({unassigned.length})</h6></div>
              <div className="card-body py-2">
                <div className="d-flex flex-wrap gap-2">
                  {unassigned.map((ip: any) => (
                    <span key={ip.pid} className="badge bg-light text-dark border">{formatPatientName(ip)} · Rm {ip.room} <span className={`badge ms-1 ${riskBadge(ip.risk?.level)}`}>{ip.risk?.level}</span></span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Admitted Patients List — sorted by risk then LOS */}
        <div className="col-lg-5">
          <div className="card border-0 shadow-sm" style={{ borderRadius: '20px' }}>
            <div className="card-header bg-white py-3 d-flex justify-content-between" style={{ borderRadius: '20px 20px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-people me-2 text-info"></i>Admitted Patients</h6>
              <span className="badge bg-info rounded-pill">{inpatients.length}</span>
            </div>
            <div className="card-body p-0" style={{ maxHeight: '560px', overflow: 'auto' }}>
              {[...inpatients]
                .sort((a, b) => (b.risk?.score || 0) - (a.risk?.score || 0) || (b.los_days || 0) - (a.los_days || 0))
                .map((ip: any) => {
                  const los = losInfo(ip.los_days);
                  return (
                    <div key={ip.pid} className="d-flex align-items-center gap-3 px-3 py-3 border-bottom" style={{ cursor: 'pointer' }}
                      onClick={() => { setSelectedRoom(ip.room); setShowPatientDetail(true); }}>
                      <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0 text-white fw-bold"
                        style={{ width: '40px', height: '40px', fontSize: '0.9rem', background: riskColor(ip.risk?.level) }}>
                        {ip.fname?.[0]}{ip.lname?.[0]}
                      </div>
                      <div className="flex-grow-1 min-w-0">
                        <div className="fw-semibold small">{formatPatientName(ip)}</div>
                        <small className="text-muted">Room {ip.room} · LOS {los.label}</small>
                        {ip.risk?.flags?.length > 0 && (
                          <div className="small text-danger" style={{ fontSize: '0.68rem' }}><i className="bi bi-exclamation-triangle me-1"></i>{ip.risk.flags.join(', ')}</div>
                        )}
                      </div>
                      <div className="text-end">
                        <span className={`badge rounded-pill mb-1 ${riskBadge(ip.risk?.level)}`} style={{ fontSize: '0.65rem' }}>NEWS2 {ip.risk?.score}</span>
                        {canWrite && (
                          <div><button className="btn btn-outline-warning btn-sm rounded-pill" style={{ fontSize: '0.65rem' }} onClick={e => {
                            e.stopPropagation(); setSelectedRoom(ip.room); setShowTransfer(true);
                          }}><i className="bi bi-arrow-left-right"></i> Transfer</button></div>
                        )}
                      </div>
                    </div>
                  );
                })}
              {inpatients.length === 0 && <div className="text-center text-muted py-4"><i className="bi bi-inbox fs-2 opacity-25"></i><p className="small">No patients admitted</p></div>}
            </div>
          </div>
        </div>
      </div>

      {/* Patient Detail Modal */}
      {showPatientDetail && activePatient && (
        <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center" style={{ zIndex: 1060, background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowPatientDetail(false)}>
          <div className="card shadow-lg" style={{ width: '560px', maxHeight: '85vh', borderRadius: '20px', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="card-header text-white py-3 d-flex justify-content-between" style={{ background: `linear-gradient(135deg, ${riskColor(activePatient.risk?.level)}, #6610f2)`, borderRadius: '20px 20px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-person-badge me-2"></i>Patient Detail — {formatPatientName(activePatient)}</h6>
              <button className="btn btn-sm btn-outline-light rounded-circle" style={{ width: '32px', height: '32px' }} onClick={() => setShowPatientDetail(false)}><i className="bi bi-x-lg"></i></button>
            </div>
            <div className="card-body">
              {activeLos && (
                <div className="rounded-3 p-3 mb-3 text-white text-center" style={{ background: `linear-gradient(135deg, ${activeLos.color}, ${activeLos.color}cc)` }}>
                  <div className="fs-3 fw-bold">{activeLos.days}</div>
                  <small>days hospitalized</small>
                </div>
              )}
              <div className="row g-2 mb-3">
                <div className="col-6"><div className="bg-light rounded-3 p-2"><small className="text-muted d-block">Room</small><strong>{activePatient.room}</strong></div></div>
                <div className="col-6"><div className="bg-light rounded-3 p-2"><small className="text-muted d-block">PID</small><strong>#{activePatient.pid}</strong></div></div>
                <div className="col-6"><div className="bg-light rounded-3 p-2"><small className="text-muted d-block">Risk</small><span className={`badge ${riskBadge(activePatient.risk?.level)}`}>NEWS2 {activePatient.risk?.score} · {activePatient.risk?.level}</span></div></div>
                <div className="col-6"><div className="bg-light rounded-3 p-2"><small className="text-muted d-block">Attending</small><strong>{activePatient.provider_name || '—'}</strong></div></div>
                {activePatient.risk?.flags?.length > 0 && (
                  <div className="col-12"><div className="alert alert-danger py-2 mb-0 small"><i className="bi bi-exclamation-triangle me-1"></i>{activePatient.risk.flags.join(' · ')}</div></div>
                )}
              </div>

              <h6 className="fw-bold mb-2"><i className="bi bi-heart-pulse me-2 text-danger"></i>Last Vitals</h6>
              <div className="row g-2 mb-3">
                {[
                  { label: 'BP', value: formatBP(activePatient?.bps, activePatient?.bpd) },
                  { label: 'Pulse', value: formatVital(activePatient?.pulse) },
                  { label: 'Temp', value: formatVital(activePatient?.temperature, 1) },
                  { label: 'SpO₂', value: activePatient?.oxygen_saturation ? `${formatVital(activePatient.oxygen_saturation)}%` : '—' },
                ].map(v => (
                  <div className="col-3" key={v.label}><div className="bg-light rounded-3 p-2 text-center"><small className="text-muted d-block">{v.label}</small><strong className="small">{v.value}</strong></div></div>
                ))}
              </div>

              <h6 className="fw-bold mb-2"><i className="bi bi-capsule me-2 text-primary"></i>Current Medications</h6>
              {(activeMeds as any[]).length > 0 ? (
                <div className="table-responsive mb-3">
                  <table className="table table-sm mb-0">
                    <thead className="table-light"><tr><th>Drug</th><th>Dosage</th><th>Route</th></tr></thead>
                    <tbody>
                      {(activeMeds as any[]).map((med: any, i: number) => (
                        <tr key={i}><td className="fw-semibold">{med.drug}</td><td>{med.dosage || '—'}</td><td><span className="badge bg-info rounded-pill">{med.route || '—'}</span></td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-muted small mb-3">No medications recorded</div>
              )}

              <div className="d-flex gap-2">
                <button className="btn btn-primary rounded-pill flex-grow-1" onClick={() => { setShowPatientDetail(false); const cid = chartPatientId(activePatient.id, activePatient.pid); if (cid) navigate(`/patients/${cid}`); }}>
                  <i className="bi bi-folder2-open me-1"></i>Open Full Chart
                </button>
                {canWrite && (
                  <>
                    <button className="btn btn-outline-warning rounded-pill" onClick={() => { setShowPatientDetail(false); setShowTransfer(true); }}>
                      <i className="bi bi-arrow-left-right me-1"></i>Transfer
                    </button>
                    <button className="btn btn-outline-danger rounded-pill" onClick={() => { setShowPatientDetail(false); setShowDischarge(true); }}>
                      <i className="bi bi-box-arrow-right me-1"></i>Discharge
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admit Modal */}
      {showAdmit && selectedRoom && (
        <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center" style={{ zIndex: 1060, background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowAdmit(false)}>
          <div className="card shadow-lg" style={{ width: '460px', borderRadius: '20px' }} onClick={e => e.stopPropagation()}>
            <div className="card-header text-white py-3" style={{ background: 'linear-gradient(135deg, #198754, #0dcaf0)', borderRadius: '20px 20px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-person-plus me-2"></i>Admit to {selectedRoom}</h6>
            </div>
            <div className="card-body">
              <div className="mb-2 position-relative">
                <label className="form-label small fw-semibold">Search patient *</label>
                <input className="form-control rounded-pill" placeholder="Type a name…" value={admitForm.search} onChange={e => setAdmitForm({ ...admitForm, search: e.target.value, pid: '' })} />
                {patients.length > 0 && !admitForm.pid && (
                  <div className="list-group position-absolute w-100 shadow" style={{ zIndex: 20, maxHeight: '220px', overflowY: 'auto' }}>
                    {patients.map((p: any) => (
                      <button key={p.pid} type="button" className="list-group-item list-group-item-action small" onClick={() => setAdmitForm({ ...admitForm, pid: String(p.pid), search: formatPatientName(p) })}>
                        {formatPatientName(p)} · PID #{p.pid}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="d-flex gap-2 mt-3">
                <button className="btn btn-success rounded-pill flex-grow-1" onClick={handleAdmit} disabled={!admitForm.pid || setRoom.isPending}><i className="bi bi-check-lg me-1"></i>Confirm Admission</button>
                <button className="btn btn-outline-secondary rounded-pill" onClick={() => { setShowAdmit(false); setAdmitForm({ pid: '', search: '' }); }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Discharge Modal */}
      {showDischarge && activePatient && (
        <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center" style={{ zIndex: 1060, background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowDischarge(false)}>
          <div className="card shadow-lg" style={{ width: '400px', borderRadius: '20px' }} onClick={e => e.stopPropagation()}>
            <div className="card-header text-white py-3" style={{ background: 'linear-gradient(135deg, #dc3545, #fd7e14)', borderRadius: '20px 20px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-box-arrow-right me-2"></i>Discharge Patient</h6>
            </div>
            <div className="card-body text-center py-4">
              <i className="bi bi-person-x fs-1 text-danger mb-2 d-block"></i>
              <p>Discharge <strong>{formatPatientName(activePatient)}</strong> from room {activePatient.room}?</p>
              {activeLos && <p className="small text-muted">Length of stay: <strong>{activeLos.label}</strong></p>}
              <div className="d-flex gap-2 mt-3">
                <button className="btn btn-danger rounded-pill flex-grow-1" onClick={handleDischarge} disabled={setRoom.isPending}><i className="bi bi-check-lg me-1"></i>Confirm Discharge</button>
                <button className="btn btn-outline-secondary rounded-pill" onClick={() => setShowDischarge(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Modal */}
      {showTransfer && activePatient && (
        <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center" style={{ zIndex: 1060, background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowTransfer(false)}>
          <div className="card shadow-lg" style={{ width: '460px', borderRadius: '20px' }} onClick={e => e.stopPropagation()}>
            <div className="card-header text-white py-3" style={{ background: 'linear-gradient(135deg, #0dcaf0, #6f42c1)', borderRadius: '20px 20px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-arrow-left-right me-2"></i>Transfer {formatPatientName(activePatient)}</h6>
            </div>
            <div className="card-body">
              <p className="small text-muted">From room <strong>{activePatient.room}</strong></p>
              <div className="mb-2"><label className="form-label small fw-semibold">Destination Ward</label>
                <select className="form-select rounded-pill" value={transferForm.toWard} onChange={e => setTransferForm({ ...transferForm, toWard: e.target.value, toBed: '' })}>
                  <option value="">— Select —</option>
                  {WARD_LAYOUT.map(w => <option key={w.id} value={w.id}>{w.name} ({w.beds.filter(b => !occupantFor(b.label)).length} avail)</option>)}
                </select>
              </div>
              {targetWard && (
                <div className="mb-3"><label className="form-label small fw-semibold">Destination Bed</label>
                  <div className="d-flex flex-wrap gap-1">
                    {targetWard.beds.filter(b => !occupantFor(b.label)).map(b => (
                      <button key={b.id} className={`btn btn-sm rounded-pill ${transferForm.toBed === b.id ? 'btn-info' : 'btn-outline-info'}`}
                        onClick={() => setTransferForm({ ...transferForm, toBed: b.id })}>{b.label}</button>
                    ))}
                    {targetWard.beds.filter(b => !occupantFor(b.label)).length === 0 && <span className="text-muted small">No free beds in this ward</span>}
                  </div>
                </div>
              )}
              <div className="d-flex gap-2">
                <button className="btn btn-info rounded-pill flex-grow-1" onClick={handleTransfer} disabled={!transferForm.toWard || !transferForm.toBed || setRoom.isPending}><i className="bi bi-arrow-left-right me-1"></i>Transfer</button>
                <button className="btn btn-outline-secondary rounded-pill" onClick={() => setShowTransfer(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
