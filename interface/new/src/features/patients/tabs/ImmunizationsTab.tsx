import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createImmunization, deleteImmunization } from '../../../api/endpoints/immunizations';

interface ImmItem { id: number; cvx_code?: string; manufacturer?: string; lot_number?: string; administered_date?: string; route?: string; administration_site?: string; note?: string; completion_status?: string }

interface Props { patientId: string; immunizations: ImmItem[]; readOnly?: boolean }

export default function ImmunizationsTab({ patientId, immunizations, readOnly = false }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ cvx_code: '', manufacturer: '', lot_number: '', administered_date: '', route: '', administration_site: '', note: '' });
  const [adding, setAdding] = useState(false);

  const reset = () => setForm({ cvx_code: '', manufacturer: '', lot_number: '', administered_date: '', route: '', administration_site: '', note: '' });

  const handleAdd = async () => {
    if (!form.cvx_code.trim()) return;
    setAdding(true);
    try {
      await createImmunization(patientId, form);
      reset();
      queryClient.invalidateQueries({ queryKey: ['patient', patientId, 'immunizations'] });
    } catch { /* ignore */ }
    finally { setAdding(false); }
  };

  const handleDelete = async (id: number) => {
    await deleteImmunization(patientId, id);
    queryClient.invalidateQueries({ queryKey: ['patient', patientId, 'immunizations'] });
  };

  return (
    <div className="card">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h5 className="mb-0"><i className="bi bi-syringe me-2"></i>Immunizations</h5>
      </div>
      <div className="card-body">
        {!readOnly && (
          <div className="row g-2 mb-3">
            <div className="col-md-2"><input className="form-control form-control-sm" placeholder="CVX Code" value={form.cvx_code} onChange={e => setForm({...form, cvx_code: e.target.value})} /></div>
            <div className="col-md-2"><input className="form-control form-control-sm" placeholder="Manufacturer" value={form.manufacturer} onChange={e => setForm({...form, manufacturer: e.target.value})} /></div>
            <div className="col-md-2"><input className="form-control form-control-sm" placeholder="Lot #" value={form.lot_number} onChange={e => setForm({...form, lot_number: e.target.value})} /></div>
            <div className="col-md-2"><input className="form-control form-control-sm" type="date" value={form.administered_date} onChange={e => setForm({...form, administered_date: e.target.value})} /></div>
            <div className="col-md-1"><input className="form-control form-control-sm" placeholder="Route" value={form.route} onChange={e => setForm({...form, route: e.target.value})} /></div>
            <div className="col-md-1"><input className="form-control form-control-sm" placeholder="Site" value={form.administration_site} onChange={e => setForm({...form, administration_site: e.target.value})} /></div>
            <div className="col-md-1">
              <button className="btn btn-primary btn-sm w-100" onClick={handleAdd} disabled={adding || !form.cvx_code.trim()}>
                {adding ? <span className="spinner-border spinner-border-sm"/> : 'Add'}
              </button>
            </div>
          </div>
        )}
        {immunizations.length === 0 ? (
          <p className="text-muted text-center mb-0">No immunizations recorded.</p>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm table-hover mb-0">
              <thead><tr><th>CVX</th><th>Manufacturer</th><th>Lot</th><th>Date</th><th>Route</th><th>Site</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {immunizations.map(i => (
                  <tr key={i.id}><td><strong>{i.cvx_code}</strong></td><td>{i.manufacturer || '—'}</td><td>{i.lot_number || '—'}</td><td>{i.administered_date || '—'}</td><td>{i.route || '—'}</td><td>{i.administration_site || '—'}</td><td><span className="badge bg-success">{i.completion_status || 'completed'}</span></td>
                    <td>{!readOnly && <button className="btn btn-outline-danger btn-sm" onClick={() => handleDelete(i.id)}><i className="bi bi-trash"/></button>}</td>
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
