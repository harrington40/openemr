import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '../../hooks/useDebounce';
import { searchPatients } from '../../api/endpoints/patients';
import type { Patient } from '../../types/patient';
import { formatPatientNameLastFirst } from '../../utils/patientName';
import { formatDateOnly } from '../../utils/date';
import { chartPatientId } from '../../utils/patientChart';
import RegisterPatientModal from './components/RegisterPatientModal';

export default function PatientSearchPage() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 300);
  const [showModal, setShowModal] = useState(false);

  const { data: patients, isLoading } = useQuery({
    queryKey: ['patients', 'search', debouncedSearch],
    queryFn: () => searchPatients({ search: debouncedSearch, limit: 50 }),
    enabled: debouncedSearch.length >= 2,
  });

  const handleSelectPatient = useCallback((patient: Patient) => {
    const cid = chartPatientId((patient as any).id, (patient as any).pid, patient.uuid);
    if (cid) navigate(`/patients/${cid}`);
  }, [navigate]);

  /**
   * Emergency arrivals start on the triage board: it is the board that knows the
   * waiting room, the targets and the other patients. Sending the pid lets the
   * board open the triage form already pointed at this patient.
   *
   * The **chart id** is sent, not the pid: `/patients/:id` resolves the primary
   * key first and on this schema `id` and `pid` are different columns, so passing
   * a pid would quietly preselect the neighbouring patient.
   */
  const handleEmergency = useCallback((patient: Patient) => {
    const chartId = chartPatientId((patient as any).id, (patient as any).pid, patient.uuid);
    if (!chartId) {
      console.error('Cannot start triage: patient has no resolvable chart id', patient);
      return;
    }
    navigate(`/emergency?chart=${chartId}`);
  }, [navigate]);


  /** Opens the standard registration form (see RegisterPatientModal). */
  const openModal = () => setShowModal(true);

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
      <div className="rounded-4 p-4 mb-4 text-white" style={{background:'linear-gradient(135deg, #198754 0%, #0d6efd 50%, #6610f2 100%)'}}>
        <div className="d-flex justify-content-between align-items-start">
          <div>
            <h2 className="mb-1 fw-bold"><i className="bi bi-people me-2"></i>Patient Management</h2>
            <p className="mb-0 text-white text-opacity-75 small">Search, register, and manage patient records</p>
          </div>
          <button className="btn btn-light rounded-pill" onClick={openModal}>
            <i className="bi bi-person-plus me-1"></i>Add Patient
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="card border-0 shadow-sm mb-4" style={{borderRadius:'16px'}}>
        <div className="card-body py-3">
          <div className="input-group">
            <span className="input-group-text bg-white border-end-0 rounded-pill-start"><i className="bi bi-search text-muted"></i></span>
            <input type="text" className="form-control border-start-0 rounded-pill-end" placeholder="Search by name, phone, or date of birth..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} autoFocus />
            {searchTerm && <button className="btn btn-outline-secondary border-start-0" onClick={() => setSearchTerm('')}><i className="bi bi-x-lg"></i></button>}
          </div>
        </div>
      </div>

      {/* Results */}
      {debouncedSearch.length >= 2 && (
        <div className="card shadow-sm border-0">
          <div className="card-header bg-white d-flex justify-content-between align-items-center py-3">
            <span className="fw-semibold">Search Results</span>
            {patients && <span className="badge bg-primary rounded-pill px-3">{patients.length} patient{patients.length !== 1 ? 's' : ''}</span>}
          </div>
          <div className="card-body p-0">
            {isLoading ? (
              <div className="text-center py-5"><div className="spinner-border text-primary"/></div>
            ) : patients && patients.length > 0 ? (
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="table-light"><tr><th>Name</th><th>DOB</th><th>Sex</th><th>Phone</th><th>ID</th><th></th></tr></thead>
                  <tbody>
                    {patients.map((patient) => (
                      <tr key={(patient as any).id || patient.uuid} onClick={() => handleSelectPatient(patient)} style={{ cursor: 'pointer' }}>
                        <td><strong>{formatPatientNameLastFirst(patient)}</strong></td>
                        <td>{formatDateOnly(patient.dob)}</td><td>{patient.sex || '—'}</td><td>{patient.phone || '—'}</td><td><code className="bg-light px-2 py-1 rounded">{patient.public_id || patient.pubpid || '—'}</code></td>
                        <td>
                          <div className="d-flex gap-1">
                            <button className="btn btn-sm btn-outline-primary rounded-pill px-3" onClick={(e) => { e.stopPropagation(); handleSelectPatient(patient); }}>Open <i className="bi bi-arrow-right ms-1"></i></button>
                            <button className="btn btn-sm btn-outline-danger rounded-pill" title="Record an emergency arrival and triage"
                              onClick={(e) => { e.stopPropagation(); handleEmergency(patient); }}>
                              <i className="bi bi-heart-pulse me-1"></i>Emergency
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="text-center py-5 text-muted">No patients found.</div>}
          </div>
        </div>
      )}

      {debouncedSearch.length < 2 && (
        <div className="text-center py-5">
          <div className="bg-light rounded-circle d-inline-flex align-items-center justify-content-center mb-3" style={{ width: '80px', height: '80px' }}>
            <i className="bi bi-search text-muted" style={{ fontSize: '2rem' }}></i>
          </div>
          <h5 className="text-muted">Search for a Patient</h5>
          <p className="text-muted small">Type a name, phone number, or date of birth above</p>
        </div>
      )}

      {/* Registration Modal */}
      {/* The standard registration flow, shared with the register page. */}
      <RegisterPatientModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onRegistered={(r) => { const cid = chartPatientId(r.id, r.pid); if (cid) navigate(`/patients/${cid}`); }}
        onUseExisting={(d) => { setShowModal(false); const cid = chartPatientId(d.id, d.pid); if (cid) navigate(`/patients/${cid}`); }}
      />
    </div>
  );
}
