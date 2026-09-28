import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';
import { formatPatientName } from '../../utils/patientName';

export default function DischargeSummaryPage() {
  const { pid } = useParams<{ pid: string }>();
  const navigate = useNavigate();
  const [synced, setSynced] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['discharge-summary', pid],
    queryFn: async () => { const r = await nestClient.get(`/patients/${pid}/discharge-summary`); return r.data; },
    enabled: !!pid,
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const r = await nestClient.post(`/patients/${pid}/discharge-summary/sync`);
      return r.data;
    },
    onSuccess: () => setSynced(true),
  });

  if (isLoading) return <div className="text-center p-5"><span className="spinner-border"></span></div>;
  if (!data) return <div className="alert alert-danger">Could not load discharge summary</div>;

  const printDoc = () => window.print();

  return (
    <div>
      {/* Header */}
      <div className="rounded-3 p-3 mb-3 text-white" style={{ background: 'linear-gradient(135deg, #0d6efd 0%, #198754 100%)' }}>
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
          <div>
            <h5 className="mb-0 fw-bold"><i className="bi bi-file-earmark-text me-2"></i>Discharge Summary</h5>
            <small className="text-white text-opacity-75">
              {formatPatientName(data.patient)} · {data.patient?.DOB} · {data.patient?.sex}
            </small>
          </div>
          <div className="d-flex gap-2">
            <button className="btn btn-outline-light btn-sm rounded-pill" onClick={() => navigate(-1)}>
              <i className="bi bi-arrow-left me-1"></i>Back
            </button>
            <button className="btn btn-light btn-sm rounded-pill" onClick={printDoc}>
              <i className="bi bi-printer me-1"></i>Print
            </button>
            {!synced && (
              <button className="btn btn-success btn-sm rounded-pill"
                onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
                {syncMutation.isPending ? 'Syncing...' : <><i className="bi bi-cloud-upload me-1"></i>Sync to Documents</>}
              </button>
            )}
            {synced && <span className="badge bg-success rounded-pill"><i className="bi bi-check me-1"></i>Synced</span>}
          </div>
        </div>
      </div>

      {/* Status Banner */}
      <div className={`alert py-2 mb-3 d-flex align-items-center gap-2 ${data.dischargeStatus === 'CLEARED' ? 'alert-success' : 'alert-warning'}`}
        style={{ borderRadius: '10px', fontSize: '0.85rem' }}>
        <i className={`bi ${data.dischargeStatus === 'CLEARED' ? 'bi-check-circle' : 'bi-exclamation-triangle'} fs-5`}></i>
        <div>
          <strong>Discharge Status: {data.dischargeStatus}</strong>
          {data.blockers?.length > 0 && (
            <div className="small mt-1">
              {data.blockers.map((b: string, i: number) => <div key={i}>• {b}</div>)}
            </div>
          )}
        </div>
      </div>

      <div className="row g-3">
        {/* Left column */}
        <div className="col-lg-8">
          {/* Clinical Summary */}
          <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '12px' }}>
            <div className="card-header bg-white py-2" style={{ borderRadius: '12px 12px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-clipboard-pulse me-2 text-primary"></i>Clinical Summary</h6>
            </div>
            <div className="card-body py-2">
              <p className="small mb-0" style={{ lineHeight: 1.6 }}>{data.clinicalSummary}</p>
            </div>
          </div>

          {/* Discharge Instructions */}
          <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '12px' }}>
            <div className="card-header bg-white py-2" style={{ borderRadius: '12px 12px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-list-check me-2 text-success"></i>Discharge Instructions</h6>
            </div>
            <div className="card-body py-2">
              <pre className="small mb-0" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.6 }}>
                {data.dischargeInstructions}
              </pre>
            </div>
          </div>

          {/* Medications */}
          {data.medications?.length > 0 && (
            <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '12px' }}>
              <div className="card-header bg-white py-2" style={{ borderRadius: '12px 12px 0 0' }}>
                <h6 className="mb-0 fw-bold"><i className="bi bi-capsule me-2 text-primary"></i>Discharge Medications</h6>
              </div>
              <div className="card-body p-0">
                <table className="table table-sm mb-0 small">
                  <thead className="table-light"><tr><th>Drug</th><th>Dosage</th><th>Route</th><th>Frequency</th></tr></thead>
                  <tbody>
                    {data.medications.map((m: any, i: number) => (
                      <tr key={i}><td className="fw-semibold">{m.drug}</td><td>{m.dosage}</td><td>{m.route || '—'}</td><td>{m.frequency || '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Vitals */}
          {data.vitals && (
            <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '12px' }}>
              <div className="card-header bg-white py-2" style={{ borderRadius: '12px 12px 0 0' }}>
                <h6 className="mb-0 fw-bold"><i className="bi bi-heart-pulse me-2 text-danger"></i>Last Vital Signs</h6>
              </div>
              <div className="card-body py-2">
                <div className="d-flex flex-wrap gap-3 small">
                  {data.vitals.temp_f && <span><strong>Temp:</strong> {data.vitals.temp_f}°F</span>}
                  {data.vitals.bp_systolic && <span><strong>BP:</strong> {data.vitals.bp_systolic}/{data.vitals.bp_diastolic}</span>}
                  {data.vitals.pulse && <span><strong>HR:</strong> {data.vitals.pulse} bpm</span>}
                  {data.vitals.respiration && <span><strong>RR:</strong> {data.vitals.respiration}/min</span>}
                  {data.vitals.oxygen_saturation && <span><strong>O2:</strong> {data.vitals.oxygen_saturation}%</span>}
                  {data.vitals.weight && <span><strong>Wt:</strong> {data.vitals.weight} kg</span>}
                  {data.vitals.bmi && <span><strong>BMI:</strong> {data.vitals.bmi}</span>}
                </div>
              </div>
            </div>
          )}

          {/* Lab Results */}
          {data.labResults?.length > 0 && (
            <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '12px' }}>
              <div className="card-header bg-white py-2" style={{ borderRadius: '12px 12px 0 0' }}>
                <h6 className="mb-0 fw-bold"><i className="bi bi-flask me-2 text-success"></i>Lab Results</h6>
              </div>
              <div className="card-body p-0">
                {data.labResults.map((l: any, i: number) => (
                  <div key={i} className="px-3 py-2 border-bottom small">
                    <div className="fw-semibold">{l.date?.split('T')[0]} — <span className="badge bg-light text-dark">{l.status}</span></div>
                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>{l.results}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="col-lg-4">
          {/* Patient Info */}
          <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '12px' }}>
            <div className="card-header bg-white py-2" style={{ borderRadius: '12px 12px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-person me-2 text-info"></i>Patient</h6>
            </div>
            <div className="card-body py-2 small">
              <div><strong>Name:</strong> {formatPatientName(data.patient)}</div>
              <div><strong>DOB:</strong> {data.patient?.DOB}</div>
              <div><strong>Sex:</strong> {data.patient?.sex}</div>
              {data.patient?.phone_contact && <div><strong>Phone:</strong> {data.patient.phone_contact}</div>}
              {data.patient?.street && <div><strong>Address:</strong> {[data.patient.street, data.patient.city].filter(Boolean).join(', ')}</div>}
            </div>
          </div>

          {/* Diagnoses */}
          {data.diagnoses?.length > 0 && (
            <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '12px' }}>
              <div className="card-header bg-white py-2" style={{ borderRadius: '12px 12px 0 0' }}>
                <h6 className="mb-0 fw-bold"><i className="bi bi-clipboard2-pulse me-2 text-warning"></i>Diagnoses</h6>
              </div>
              <div className="card-body py-2 small">
                {data.diagnoses.map((d: any, i: number) => (
                  <div key={i} className="mb-1">• {d.name}{d.code ? <code className="ms-1 small">{d.code}</code> : ''}</div>
                ))}
              </div>
            </div>
          )}

          {/* Allergies */}
          {data.allergies?.length > 0 && (
            <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '12px' }}>
              <div className="card-header bg-white py-2" style={{ borderRadius: '12px 12px 0 0' }}>
                <h6 className="mb-0 fw-bold"><i className="bi bi-exclamation-triangle me-2 text-danger"></i>Allergies</h6>
              </div>
              <div className="card-body py-2 small">
                {data.allergies.map((a: any, i: number) => (
                  <div key={i} className="mb-1">
                    <span className="fw-semibold">{a.name}</span>
                    {a.severity && <span className={`badge ms-1 ${a.severity === 'severe' ? 'bg-danger' : 'bg-warning text-dark'}`} style={{ fontSize: '0.6rem' }}>{a.severity}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Financial Summary */}
          <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '12px' }}>
            <div className="card-header bg-white py-2" style={{ borderRadius: '12px 12px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-cash-stack me-2" style={{ color: '#C8102E' }}></i>Financial Summary</h6>
            </div>
            <div className="card-body py-2 small">
              <div className="d-flex justify-content-between mb-1"><span>Total Charges:</span><strong>${data.financialSummary?.totalCharges?.toFixed(2)}</strong></div>
              <div className="d-flex justify-content-between mb-1"><span>Total Payments:</span><strong className="text-success">${data.financialSummary?.totalPayments?.toFixed(2)}</strong></div>
              <div className="d-flex justify-content-between mb-1"><span>Balance:</span><strong className={data.financialSummary?.balance > 0 ? 'text-danger' : 'text-success'}>${data.financialSummary?.balance?.toFixed(2)}</strong></div>
              <div className="d-flex justify-content-between mb-1"><span>Insurance Covered:</span><span>${data.financialSummary?.insuranceCovered?.toFixed(2)}</span></div>
              <div className="d-flex justify-content-between"><span>Patient Obligation:</span><strong>${data.financialSummary?.patientObligation?.toFixed(2)}</strong></div>
            </div>
          </div>

          {/* Recent Visits */}
          {data.recentEncounters?.length > 1 && (
            <div className="card border-0 shadow-sm" style={{ borderRadius: '12px' }}>
              <div className="card-header bg-white py-2" style={{ borderRadius: '12px 12px 0 0' }}>
                <h6 className="mb-0 fw-bold"><i className="bi bi-clock-history me-2 text-info"></i>Recent Visits</h6>
              </div>
              <div className="card-body py-2 small">
                {data.recentEncounters.map((e: any, i: number) => (
                  <div key={i} className="mb-1">{e.date?.split(' ')[0]}: {e.reason || 'Visit'} <span className="text-muted">({e.disposition || 'N/A'})</span></div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
