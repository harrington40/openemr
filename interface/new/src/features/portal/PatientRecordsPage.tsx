import { useNavigate } from 'react-router-dom';

export default function PatientRecordsPage() {
  const navigate = useNavigate();
  const raw = localStorage.getItem('portal_patient');
  const patient = raw ? JSON.parse(raw) : null;
  if (!patient) { navigate('/portal/login'); return null; }

  const downloadCcda = () => window.open(`http://localhost:3002/api/patients/${patient.pid}/ccda`, '_blank');
  const downloadFhir = () => window.open(`http://localhost:3002/api/fhir/Patient/${patient.pid}`, '_blank');

  return (
    <div className="min-vh-100 bg-light">
      <nav className="navbar navbar-dark bg-primary px-4"><span className="navbar-brand"><i className="bi bi-download me-2"></i>Medical Records</span>
        <button className="btn btn-outline-light btn-sm" onClick={() => navigate('/portal/dashboard')}>Back</button></nav>
      <div className="container py-4">
        <div className="row g-3">
          <div className="col-md-4"><div className="card shadow-sm text-center" style={{cursor:'pointer'}} onClick={downloadCcda}><div className="card-body py-5"><i className="bi bi-file-earmark-text text-primary" style={{fontSize:'3rem'}}></i><h5 className="mt-3">CCDA Export</h5><p className="text-muted small">Continuity of Care Document (XML)</p><span className="badge bg-primary">Download</span></div></div></div>
          <div className="col-md-4"><div className="card shadow-sm text-center" style={{cursor:'pointer'}} onClick={downloadFhir}><div className="card-body py-5"><i className="bi bi-code-slash text-info" style={{fontSize:'3rem'}}></i><h5 className="mt-3">FHIR Data</h5><p className="text-muted small">FHIR R4 Patient resource (JSON)</p><span className="badge bg-info">Download</span></div></div></div>
          <div className="col-md-4"><div className="card shadow-sm text-center"><div className="card-body py-5"><i className="bi bi-send text-success" style={{fontSize:'3rem'}}></i><h5 className="mt-3">Send via Direct</h5><p className="text-muted small">Securely send records to another provider</p><span className="badge bg-success">Coming Soon</span></div></div></div>
        </div>
      </div>
    </div>
  );
}
