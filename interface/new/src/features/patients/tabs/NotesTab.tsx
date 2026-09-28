import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../../api/nest-client';
import { useAuth } from '../../../hooks/useAuth';

interface Props {
  patientId: string;
  patientName: string;
  patientAge?: number | null;
  conditions?: any[];
  medications?: any[];
  allergies?: any[];
}

const ROOM_NUMBERS = ['101', '102', '103', '104', '105', '201', '202', '203', '204', '205', '301', '302', 'ER-1', 'ER-2', 'ICU-1', 'ICU-2'];

const SMART_TEMPLATES: { label: string; icon: string; template: string; condition?: string }[] = [
  { label: 'General SOAP', icon: 'bi-journal-medical', template: 'S: Patient reports \nO: Vital signs stable. \nA: \nP: ' },
  { label: 'Diabetes Follow-up', icon: 'bi-droplet', template: 'S: Blood sugar log reviewed. \nO: Today\'s BG:  mg/dL. Foot exam: normal. \nA: Diabetes mellitus, controlled. \nP: Continue current regimen. Follow up in 3 months.', condition: 'diabetes' },
  { label: 'Hypertension Check', icon: 'bi-heart', template: 'S: No acute complaints. \nO: BP today: /. Heart: RRR, no murmurs. \nA: Essential hypertension. \nP: Continue antihypertensives. Low-sodium diet.', condition: 'hypertension' },
  { label: 'URI / Cold', icon: 'bi-thermometer', template: 'S: Cough, congestion x  days. \nO: Lungs clear. Throat: erythematous. \nA: Upper respiratory infection. \nP: Supportive care. Increased fluids. Return if worsening.' },
  { label: 'Annual Physical', icon: 'bi-clipboard-check', template: 'S: No acute concerns. \nO: VS stable. Physical exam unremarkable. \nA: Well adult exam. \nP: Routine labs ordered. Follow up prn.' },
  { label: 'Pain Assessment', icon: 'bi-exclamation-triangle', template: 'S: Pain rating: /10. Location: . Onset: . \nO: \nA: \nP: ' },
  { label: 'Medication Refill', icon: 'bi-capsule', template: 'S: Requesting refill of: \nO: Condition stable on current meds. \nA: \nP: Refill authorized x 90 days.' },
];

const QUICK_PHRASES = ['Stable', 'Improving', 'No acute distress', 'Well-nourished', 'Alert & oriented x3', 'Denies pain', 'Tolerating PO', 'Ambulatory', 'Follow up prn', 'Return precautions given'];

export default function NotesTab({ patientId, patientName, patientAge, conditions = [], medications = [], allergies = [] }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isNurse = user?.role === 'nurse';
  const [room, setRoom] = useState('');
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  // Fetch existing notes
  const { data: existingNotes = [] } = useQuery({
    queryKey: ['patient', patientId, 'notes'],
    queryFn: async () => {
      try {
        const r = await nestClient.get(`/patients/${patientId}/notes`);
        return r.data || [];
      } catch { return []; }
    },
    enabled: !!patientId,
  });

  // Fetch room assignment — the query calls setRoom() as a side effect.
  useQuery({
    queryKey: ['patient', patientId, 'room'],
    queryFn: async () => {
      try {
        const r = await nestClient.get(`/patients/${patientId}/room`);
        if (r.data?.room) { setRoom(r.data.room); }
        return r.data;
      } catch { return null; }
    },
    enabled: !!patientId,
  });

  const saveNote = useMutation({
    mutationFn: (data: { note: string; room?: string }) =>
      nestClient.post(`/patients/${patientId}/notes`, {
        note: data.note,
        room: data.room,
        title: isNurse ? 'Nurse Note' : undefined,
        noteType: isNurse ? 'nurse' : undefined,
        shareWithNursing: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId, 'notes'] });
      setSaved(true);
      setLastSaved(new Date().toLocaleTimeString());
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const updateRoom = useMutation({
    mutationFn: (room: string) =>
      nestClient.patch(`/patients/${patientId}/room`, { room }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId, 'room'] });
    },
  });

  // Smart suggestions based on patient data
  const smartSuggestions: string[] = [];
  if (allergies?.length > 0) {
    smartSuggestions.push(`⚠️ Allergies: ${allergies.map((a: any) => a.diagnosis || a.title).join(', ')}`);
  }
  if (medications?.length > 0) {
    smartSuggestions.push(`💊 Current meds: ${medications.map((m: any) => m.drug || m.name).slice(0, 5).join(', ')}`);
  }
  if (conditions?.length > 0) {
    smartSuggestions.push(`📋 Active: ${conditions.map((c: any) => c.diagnosis || c.title).join(', ')}`);
  }
  if (patientAge != null) {
    if (patientAge > 65) smartSuggestions.push('👴 Geriatric precautions — fall risk, polypharmacy review');
    if (patientAge < 18) smartSuggestions.push('👶 Pediatric patient — weight-based dosing');
  }

  const applyTemplate = (template: string) => {
    setNote(template);
    setShowTemplates(false);
  };

  const insertPhrase = (phrase: string) => {
    setNote(prev => prev + (prev ? '\n' : '') + phrase);
  };

  const handleSave = () => {
    if (!note.trim()) return;
    saveNote.mutate({ note: note.trim(), room: room || undefined });
  };

  // Auto-save on idle (60 seconds after last edit)
  useEffect(() => {
    if (!note.trim()) return;
    const timer = setTimeout(() => {
      saveNote.mutate({ note: note.trim(), room: room || undefined });
    }, 60000);
    return () => clearTimeout(timer);
  }, [note]);

  return (
    <div>
      {/* Room Number + Quick Stats Bar */}
      <div className="row g-3 mb-3">
        <div className="col-md-4">
          <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
            <div className="card-body d-flex align-items-center gap-3 py-2 px-3">
              <i className="bi bi-door-open fs-4 text-primary"></i>
              <div className="flex-grow-1">
                <small className="text-muted d-block">Room Number</small>
                <select className="form-select form-select-sm border-0 bg-light rounded-pill"
                  value={room} onChange={e => { setRoom(e.target.value); updateRoom.mutate(e.target.value); }}>
                  <option value="">— Assign Room —</option>
                  {ROOM_NUMBERS.map(r => <option key={r} value={r}>Room {r}</option>)}
                </select>
              </div>
              {room && (
                <span className="badge bg-primary rounded-pill fs-6">{room}</span>
              )}
            </div>
          </div>
        </div>
        <div className="col-md-8">
          <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
            <div className="card-body d-flex align-items-center gap-2 py-2 px-3 flex-wrap">
              <small className="text-muted text-nowrap"><i className="bi bi-lightbulb text-warning me-1"></i>Smart:</small>
              {smartSuggestions.length > 0 ? (
                smartSuggestions.map((s, i) => (
                  <span key={i} className="badge bg-light text-dark border small" style={{ fontSize: '0.7rem' }}>{s}</span>
                ))
              ) : (
                <span className="text-muted small">No alerts</span>
              )}
              {saved && <span className="badge bg-success rounded-pill ms-auto"><i className="bi bi-check-lg me-1"></i>Saved {lastSaved}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Note Editor */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
        <div className="card-header bg-white d-flex justify-content-between align-items-center py-3" style={{ borderRadius: '16px 16px 0 0' }}>
          <h6 className="mb-0 fw-bold">
            <i className="bi bi-pencil-square me-2 text-primary"></i>Progress Notes — {patientName}
          </h6>
          <div className="d-flex gap-2">
            <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setShowTemplates(!showTemplates)}>
              <i className="bi bi-file-earmark-text me-1"></i>Templates
            </button>
            <button className="btn btn-primary btn-sm rounded-pill" onClick={handleSave}
              disabled={saveNote.isPending || !note.trim()}>
              {saveNote.isPending ? (
                <><span className="spinner-border spinner-border-sm me-1"></span>Saving...</>
              ) : (
                <><i className="bi bi-check-lg me-1"></i>{isNurse ? 'Add Nurse Note' : 'Save Note'}</>
              )}
            </button>
          </div>
        </div>

        {/* Templates Panel */}
        {showTemplates && (
          <div className="px-3 pb-2 bg-light border-bottom">
            <small className="text-muted d-block mb-2">Click a template to populate the note:</small>
            <div className="d-flex flex-wrap gap-1 mb-2">
              {SMART_TEMPLATES.map((t, i) => (
                <button key={i} className="btn btn-outline-secondary btn-sm rounded-pill"
                  onClick={() => applyTemplate(t.template)}>
                  <i className={`bi ${t.icon} me-1`}></i>{t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="card-body">
          <textarea
            className="form-control border-0 bg-light"
            rows={12}
            style={{ borderRadius: '12px', resize: 'vertical', fontSize: '0.9rem', fontFamily: 'system-ui, sans-serif', lineHeight: 1.6 }}
            placeholder={`S: (Subjective — what the patient reports)\nO: (Objective — vital signs, exam findings)\nA: (Assessment — diagnosis, differential)\nP: (Plan — orders, medications, follow-up)`}
            value={note}
            onChange={e => setNote(e.target.value)}
          />

          {/* Quick Phrase Buttons */}
          <div className="d-flex flex-wrap gap-1 mt-2">
            <small className="text-muted me-2">Quick insert:</small>
            {QUICK_PHRASES.map((phrase, i) => (
              <button key={i} className="btn btn-light btn-sm rounded-pill border" style={{ fontSize: '0.7rem' }}
                onClick={() => insertPhrase(phrase)}>
                + {phrase}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Previous Notes History */}
      {existingNotes.length > 0 && (
        <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
          <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
            <h6 className="mb-0 fw-bold">
              <i className="bi bi-clock-history me-2 text-info"></i>Note History ({existingNotes.length})
            </h6>
          </div>
          <div className="card-body p-0">
            {existingNotes.map((n: any, i: number) => (
              <div key={n.id || i} className="px-3 py-3 border-bottom">
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <small className="text-muted">
                    <i className="bi bi-person me-1"></i>{n.user || n.created_by || 'Provider'}
                    <span className="mx-1">·</span>
                    <i className="bi bi-clock me-1"></i>{n.date ? new Date(n.date).toLocaleString() : '—'}
                  </small>
                  {n.room && <span className="badge bg-info rounded-pill small">Room {n.room}</span>}
                </div>
                <div className="small" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {n.note || n.body || n.title || '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
