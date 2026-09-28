import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getEncounter, getSoapNotes, getVitals, updateEncounter } from '../../api/endpoints/encounters';
import { getPatient } from '../../api/endpoints/patients';
import VitalSignsForm from './VitalSignsForm';
import VoiceInput from '../../components/common/VoiceInput';
import nestClient from '../../api/nest-client';
import { formatPatientNameLastFirst } from '../../utils/patientName';

type TabId = 'visit' | 'soap' | 'vitals';

export default function EncounterDetailPage() {
  const { id: patientUuid, encounterId: encounterUuid } = useParams<{
    id: string;
    encounterId: string;
  }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('visit');
  const [editReason, setEditReason] = useState(false);
  const [reasonText, setReasonText] = useState('');

  const { data: patient } = useQuery({
    queryKey: ['patient', patientUuid],
    queryFn: () => getPatient(patientUuid!),
    enabled: !!patientUuid,
  });

  const { data: encounter, isLoading } = useQuery({
    queryKey: ['encounter', encounterUuid],
    queryFn: () => getEncounter(patientUuid!, encounterUuid!),
    enabled: !!patientUuid && !!encounterUuid,
  });

  const { data: soapNotes } = useQuery({
    queryKey: ['encounter', encounterUuid, 'soap'],
    queryFn: () => getSoapNotes(patient?.pubpid || '', encounter?.id || ''),
    enabled: !!patient?.pubpid && !!encounter?.id && activeTab === 'soap',
  });

  const { data: vitals } = useQuery({
    queryKey: ['encounter', encounterUuid, 'vitals'],
    queryFn: () => getVitals(patient?.pubpid || '', encounter?.id || ''),
    enabled: !!patient?.pubpid && !!encounter?.id && activeTab === 'vitals',
  });

  if (isLoading) {
    return (
      <div className="text-center p-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  if (!encounter) {
    return (
      <div className="alert alert-danger">
        <i className="bi bi-exclamation-circle me-2"></i>
        Description not found.
      </div>
    );
  }

  const classColors: Record<string, string> = {
    AMB: 'bg-success',
    EMER: 'bg-danger',
    IMP: 'bg-primary',
    OBS: 'bg-warning text-dark',
    VR: 'bg-info',
  };

  return (
    <div>
      {/* Breadcrumb */}
      <nav aria-label="breadcrumb" className="mb-3">
        <ol className="breadcrumb">
          <li className="breadcrumb-item">
            <a href="/app/patients" onClick={(e) => { e.preventDefault(); navigate('/patients'); }} style={{ cursor: 'pointer' }}>
              Patient Search
            </a>
          </li>
          <li className="breadcrumb-item">
            <a href={`/app/patients/${patientUuid}`} onClick={(e) => { e.preventDefault(); navigate(`/patients/${patientUuid}`); }} style={{ cursor: 'pointer' }}>
              {patient ? formatPatientNameLastFirst(patient) : 'Patient'}
            </a>
          </li>
          <li className="breadcrumb-item">
            <a href={`/app/patients/${patientUuid}/encounters`} onClick={(e) => { e.preventDefault(); navigate(`/patients/${patientUuid}/encounters`); }} style={{ cursor: 'pointer' }}>
              Visits
            </a>
          </li>
          <li className="breadcrumb-item active">{encounter.date}</li>
        </ol>
      </nav>

      {/* Description header */}
      <div className="card mb-4">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-start">
            <div>
              <h4 className="mb-1">
                <i className="bi bi-file-medical me-2"></i>
                Description — {encounter.date}
              </h4>
              <p className="text-muted mb-0">
                <span className={`badge ${classColors[encounter.class_code ?? ''] ?? 'bg-secondary'} me-2`}>
                  {encounter.class_title || encounter.class_code || '—'}
                </span>
                {encounter.pc_catname && (
                  <span className="badge bg-info me-2">{encounter.pc_catname}</span>
                )}
                {encounter.facility && (
                  <span className="text-muted">
                    <i className="bi bi-building me-1"></i>
                    {encounter.facility}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Description field — inline editable */}
          <div className="mt-3">
            <strong>Description:</strong>
            {editReason ? (
              <div className="d-flex gap-2 mt-1">
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                />
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    updateEncounter(patientUuid!, encounterUuid!, { reason: reasonText });
                    setEditReason(false);
                  }}
                >
                  Save
                </button>
                <button className="btn btn-sm btn-secondary" onClick={() => setEditReason(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div
                className="mt-1"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  setReasonText(encounter.reason || '');
                  setEditReason(true);
                }}
              >
                {encounter.reason || (
                  <span className="text-muted fst-italic">
                    <i className="bi bi-pencil me-1"></i>
                    Add description...
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <ul className="nav nav-tabs mb-4">
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'visit' ? 'active' : ''}`}
            onClick={() => setActiveTab('visit')}
          >
            <i className="bi bi-info-circle me-1"></i>
            Visit Details
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'soap' ? 'active' : ''}`}
            onClick={() => setActiveTab('soap')}
          >
            <i className="bi bi-journal-text me-1"></i>
            SOAP Notes
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'vitals' ? 'active' : ''}`}
            onClick={() => setActiveTab('vitals')}
          >
            <i className="bi bi-heart-pulse me-1"></i>
            Vital Signs
          </button>
        </li>
      </ul>

      {/* Tab Content */}
      {activeTab === 'visit' && (
        <div className="card">
          <div className="card-header">
            <h5 className="mb-0">Visit Details</h5>
          </div>
          <div className="card-body">
            <div className="row">
              <div className="col-md-4 mb-3">
                <div className="text-muted small text-uppercase">Date</div>
                <div className="fw-medium">{encounter.date}</div>
              </div>
              <div className="col-md-4 mb-3">
                <div className="text-muted small text-uppercase">Onset Date</div>
                <div className="fw-medium">{encounter.onset_date || '—'}</div>
              </div>
              <div className="col-md-4 mb-3">
                <div className="text-muted small text-uppercase">Facility</div>
                <div className="fw-medium">{encounter.facility || '—'}</div>
              </div>
              <div className="col-md-4 mb-3">
                <div className="text-muted small text-uppercase">Provider ID</div>
                <div className="fw-medium">{encounter.provider_id || '—'}</div>
              </div>
              <div className="col-md-4 mb-3">
                <div className="text-muted small text-uppercase">Sensitivity</div>
                <div className="fw-medium">{encounter.sensitivity || '—'}</div>
              </div>
              <div className="col-md-4 mb-3">
                <div className="text-muted small text-uppercase">POS Code</div>
                <div className="fw-medium">{encounter.pos_code || '—'}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'soap' && (
        <SoapNotesTab patientId={patientUuid || ''} encounterId={encounterUuid || ''} existingNotes={soapNotes || []} />
      )}

      {activeTab === 'vitals' && (
        <VitalSignsForm
          pid={patient?.pubpid || ''}
          eid={encounter?.id || ''}
          vitals={vitals || []}
        />
      )}
    </div>
  );
}

function SoapNotesTab({ patientId, encounterId, existingNotes }: { patientId: string; encounterId: string; existingNotes: any[] }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ subjective: '', objective: '', assessment: '', plan: '' });

  const createSoap = useMutation({
    mutationFn: (data: any) => nestClient.post(`/patients/${patientId}/encounters/${encounterId}/soap`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['encounter', encounterId, 'soap'] });
      setForm({ subjective: '', objective: '', assessment: '', plan: '' });
    },
  });

  return (
    <div className="card">
      <div className="card-header d-flex justify-content-between">
        <h5 className="mb-0">SOAP Notes</h5>
        <small className="text-muted">🎤 Voice dictation available</small>
      </div>
      <div className="card-body">
        {/* Voice dictation input */}
        <div className="mb-3 p-2 bg-light rounded border">
          <VoiceInput onResult={(text) => setForm(f => ({ ...f, subjective: f.subjective + ' ' + text }))} />
        </div>

        <div className="row g-2 mb-3">
          <div className="col-md-6">
            <label className="form-label small">Subjective <VoiceInput onResult={(text) => setForm(f => ({ ...f, subjective: f.subjective + ' ' + text }))} /></label>
            <textarea className="form-control form-control-sm" rows={3} value={form.subjective} onChange={e => setForm({...form, subjective: e.target.value})} placeholder="Patient's description of symptoms..." />
          </div>
          <div className="col-md-6">
            <label className="form-label small">Objective <VoiceInput onResult={(text) => setForm(f => ({ ...f, objective: f.objective + ' ' + text }))} /></label>
            <textarea className="form-control form-control-sm" rows={3} value={form.objective} onChange={e => setForm({...form, objective: e.target.value})} placeholder="Physical exam findings, vitals..." />
          </div>
          <div className="col-md-6">
            <label className="form-label small">Assessment <VoiceInput onResult={(text) => setForm(f => ({ ...f, assessment: f.assessment + ' ' + text }))} /></label>
            <textarea className="form-control form-control-sm" rows={3} value={form.assessment} onChange={e => setForm({...form, assessment: e.target.value})} placeholder="Diagnosis, differential..." />
          </div>
          <div className="col-md-6">
            <label className="form-label small">Plan <VoiceInput onResult={(text) => setForm(f => ({ ...f, plan: f.plan + ' ' + text }))} /></label>
            <textarea className="form-control form-control-sm" rows={3} value={form.plan} onChange={e => setForm({...form, plan: e.target.value})} placeholder="Treatment plan, follow-up..." />
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => createSoap.mutate(form)} disabled={createSoap.isPending}>
          {createSoap.isPending ? 'Saving...' : 'Save SOAP Note'}
        </button>

        {/* Existing notes */}
        {existingNotes.length > 0 && (
          <div className="mt-3">
            <h6>Previous Notes</h6>
            {existingNotes.map((note: any) => (
              <div key={note.id} className="mb-2 p-2 bg-light rounded small">
                <div className="text-muted">{note.date}</div>
                {note.subjective && <div><strong>S:</strong> {note.subjective}</div>}
                {note.objective && <div><strong>O:</strong> {note.objective}</div>}
                {note.assessment && <div><strong>A:</strong> {note.assessment}</div>}
                {note.plan && <div><strong>P:</strong> {note.plan}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
