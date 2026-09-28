import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createCondition, updateCondition, deleteCondition } from '../../../api/endpoints/conditions';

interface CondItem { id: number; diagnosis: string; note?: string; date?: string }

interface Props { patientId: string; conditions: CondItem[]; readOnly?: boolean }

export default function ConditionsTab({ patientId, conditions, readOnly = false }: Props) {
  const queryClient = useQueryClient();
  const [diagnosis, setDiagnosis] = useState('');
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);

  const reset = () => { setDiagnosis(''); setNote(''); setEditId(null); };

  const handleSubmit = async () => {
    if (!diagnosis.trim()) return;
    setAdding(true);
    try {
      if (editId) await updateCondition(patientId, editId, { diagnosis: diagnosis.trim(), note: note.trim() });
      else await createCondition(patientId, { diagnosis: diagnosis.trim(), note: note.trim() });
      reset();
      queryClient.invalidateQueries({ queryKey: ['patient', patientId, 'conditions'] });
    } catch { /* ignore */ }
    finally { setAdding(false); }
  };

  const handleDelete = async (id: number) => {
    await deleteCondition(patientId, id);
    queryClient.invalidateQueries({ queryKey: ['patient', patientId, 'conditions'] });
  };

  const handleEdit = (c: CondItem) => {
    setEditId(c.id); setDiagnosis(c.diagnosis || ''); setNote(c.note || '');
  };

  return (
    <div className="card">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h5 className="mb-0"><i className="bi bi-clipboard2-pulse me-2"></i>Diagnoses</h5>
        {editId && <span className="badge bg-warning">Editing</span>}
      </div>
      <div className="card-body">
        {!readOnly && (
          <div className="row g-2 mb-3">
            <div className="col-md-5"><input className="form-control form-control-sm" placeholder="Diagnosis (e.g. Hypertension)" value={diagnosis} onChange={e => setDiagnosis(e.target.value)} /></div>
            <div className="col-md-4"><input className="form-control form-control-sm" placeholder="Note" value={note} onChange={e => setNote(e.target.value)} /></div>
            <div className="col-md-2">
              <button className="btn btn-primary btn-sm w-100" onClick={handleSubmit} disabled={adding || !diagnosis.trim()}>
                {adding ? <span className="spinner-border spinner-border-sm"/> : editId ? 'Update' : 'Add'}
              </button>
            </div>
            <div className="col-md-1">{editId && <button className="btn btn-outline-secondary btn-sm w-100" onClick={reset}>Cancel</button>}</div>
          </div>
        )}
        {conditions.length === 0 ? (
          <p className="text-muted text-center mb-0">No diagnoses recorded.</p>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm table-hover mb-0">
              <thead><tr><th>Diagnosis</th><th>Note</th><th>Date</th><th></th></tr></thead>
              <tbody>
                {conditions.map(c => (
                  <tr key={c.id}><td><strong>{c.diagnosis}</strong></td><td>{c.note || '—'}</td><td>{c.date || '—'}</td>
                    <td>
                      {!readOnly && (
                        <>
                          <button className="btn btn-outline-secondary btn-sm me-1" onClick={() => handleEdit(c)}><i className="bi bi-pencil"/></button>
                          <button className="btn btn-outline-danger btn-sm" onClick={() => handleDelete(c.id)}><i className="bi bi-trash"/></button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
