import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import nestClient from '../../api/nest-client';
import { formatPatientName } from '../../utils/patientName';
import LabResultEntry from '../labs/LabResultEntry';

/**
 * Patient Laboratory Result Form. Uses the same shared "Test Request" result
 * entry as the Lab Orders and Lab Management pages.
 */
export default function LabResultFormPage() {
  const { pid: urlPid } = useParams<{ pid: string }>();
  const [selectedPid, setSelectedPid] = useState<string>(urlPid || '');
  const [patientSearch, setPatientSearch] = useState('');

  const { data: patients = [] } = useQuery({
    queryKey: ['lab-patient-search', patientSearch],
    queryFn: async () => {
      if (patientSearch.trim().length < 2) return [];
      const r = await nestClient.get('/patients', { params: { search: patientSearch, limit: 15 } });
      return r.data || [];
    },
    enabled: patientSearch.trim().length >= 2,
  });

  const { data: patient } = useQuery({
    queryKey: ['lab-form-patient', selectedPid],
    queryFn: async () => (await nestClient.get(`/patients/${selectedPid}`)).data,
    enabled: !!selectedPid,
  });

  return (
    <div className="position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #dbeafe 0%, #f5faff 45%, #d1fae5 100%)', borderRadius: '20px', minHeight: '100vh', padding: '16px' }}>
      <div className="rounded-4 p-4 mb-4 text-white" style={{ background: 'linear-gradient(135deg, #0d6efd 0%, #198754 60%, #00c9a7 100%)' }}>
        <h3 className="mb-1 fw-bold"><i className="bi bi-droplet-half me-2"></i>Patient Laboratory Result Form</h3>
        <p className="mb-0 text-white text-opacity-75 small">MA JUAH MEMORIAL CLINIC · DELIVERING QUALITY MEDICAL SERVICES</p>
      </div>

      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
        <div className="card-body">
          <label className="form-label small fw-semibold">Select patient</label>
          <div className="position-relative">
            <input className="form-control" placeholder="Search patient name…" value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)} />
            {patientSearch.trim().length >= 2 && (patients as any[]).length > 0 && (
              <div className="list-group position-absolute w-100 shadow" style={{ zIndex: 20, maxHeight: 260, overflowY: 'auto' }}>
                {(patients as any[]).map((p: any) => (
                  <button key={p.id || p.pid} type="button" className="list-group-item list-group-item-action small"
                    onClick={() => { setSelectedPid(String(p.pid ?? p.id)); setPatientSearch(''); }}>
                    {formatPatientName(p)} · PID {p.pid ?? p.id}
                  </button>
                ))}
              </div>
            )}
          </div>
          {patient && (
            <div className="mt-2 small text-muted">
              Loaded: <strong>{formatPatientName(patient)}</strong> · PID {(patient as any).pid}
            </div>
          )}
        </div>
      </div>

      <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
        <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
          <h6 className="mb-0 fw-bold"><i className="bi bi-clipboard2-pulse me-2 text-success"></i>Result Entry</h6>
        </div>
        <div className="card-body">
          {selectedPid ? (
            <LabResultEntry patientPid={selectedPid} showOrderPicker />
          ) : (
            <div className="text-muted small py-3">Search and select a patient to enter or view results.</div>
          )}
        </div>
      </div>
    </div>
  );
}
