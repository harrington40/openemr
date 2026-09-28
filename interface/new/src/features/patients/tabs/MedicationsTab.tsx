import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createMedication, updateMedication, deleteMedication } from '../../../api/endpoints/medications';

interface Props { patientId: string; medications: any[]; readOnly?: boolean; allergies?: any[]; conditions?: any[] }

/** Common formulary with default dosage + quantity (adult, standard). */
const DRUG_FORMULARY: { name: string; dosage: string; quantity: string; route: string; refills: number }[] = [
  { name: 'Lisinopril 10mg', dosage: '10 mg', quantity: '30', route: 'PO', refills: 3 },
  { name: 'Amlodipine 5mg', dosage: '5 mg', quantity: '30', route: 'PO', refills: 3 },
  { name: 'Metformin 500mg', dosage: '500 mg', quantity: '60', route: 'PO', refills: 3 },
  { name: 'Glipizide 5mg', dosage: '5 mg', quantity: '30', route: 'PO', refills: 3 },
  { name: 'Atorvastatin 20mg', dosage: '20 mg', quantity: '30', route: 'PO', refills: 3 },
  { name: 'Amoxicillin 500mg', dosage: '500 mg', quantity: '21', route: 'PO', refills: 0 },
  { name: 'Azithromycin 250mg', dosage: '250 mg', quantity: '6', route: 'PO', refills: 0 },
  { name: 'Nitrofurantoin 100mg', dosage: '100 mg', quantity: '14', route: 'PO', refills: 0 },
  { name: 'Acetaminophen 500mg', dosage: '500 mg', quantity: '30', route: 'PO', refills: 1 },
  { name: 'Ibuprofen 600mg', dosage: '600 mg', quantity: '30', route: 'PO', refills: 1 },
  { name: 'Omeprazole 20mg', dosage: '20 mg', quantity: '30', route: 'PO', refills: 3 },
  { name: 'Albuterol 90mcg', dosage: '90 mcg', quantity: '1', route: 'Inhalation', refills: 3 },
  { name: 'Sertraline 50mg', dosage: '50 mg', quantity: '30', route: 'PO', refills: 3 },
  { name: 'Warfarin 5mg', dosage: '5 mg', quantity: '30', route: 'PO', refills: 3 },
];

/** Diagnosis keyword → recommended first-line drugs. */
const DIAGNOSIS_DRUGS: Record<string, string[]> = {
  hypertension: ['Lisinopril 10mg', 'Amlodipine 5mg'],
  diabetes: ['Metformin 500mg', 'Glipizide 5mg'],
  hyperlipidemia: ['Atorvastatin 20mg'],
  cholesterol: ['Atorvastatin 20mg'],
  infection: ['Amoxicillin 500mg', 'Azithromycin 250mg'],
  uti: ['Nitrofurantoin 100mg'],
  pain: ['Acetaminophen 500mg', 'Ibuprofen 600mg'],
  gerd: ['Omeprazole 20mg'],
  reflux: ['Omeprazole 20mg'],
  asthma: ['Albuterol 90mcg'],
  depression: ['Sertraline 50mg'],
  anticoagulation: ['Warfarin 5mg'],
};

/** Known drug-class interaction pairs (simplified safety reference). */
const INTERACTIONS: Record<string, string[]> = {
  warfarin: ['aspirin', 'ibuprofen', 'naproxen', 'diclofenac', 'amoxicillin', 'ciprofloxacin'],
  aspirin: ['warfarin', 'ibuprofen', 'naproxen'],
  ibuprofen: ['warfarin', 'aspirin', 'lisinopril'],
  naproxen: ['warfarin', 'aspirin'],
  lisinopril: ['potassium', 'spironolactone', 'ibuprofen'],
  spironolactone: ['lisinopril', 'potassium'],
  metformin: ['contrast'],
  digoxin: ['amiodarone', 'verapamil'],
  amiodarone: ['digoxin', 'warfarin'],
  simvastatin: ['clarithromycin', 'erythromycin', 'itraconazole'],
  clarithromycin: ['simvastatin', 'warfarin'],
};

const norm = (s: any) => String(s || '').toLowerCase().trim();

export default function MedicationsTab({ patientId, medications, readOnly = false, allergies = [], conditions = [] }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ drug: '', dosage: '', quantity: '', route: '', refills: 0, note: '' });
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [warn, setWarn] = useState('');
  const [search, setSearch] = useState('');

  const activeMeds = useMemo(() => (medications || []).filter((m: any) => Number(m.active ?? 1) !== 0), [medications]);
  const allergyNames = (allergies || []).map((a: any) => norm(a.allergen || a.title)).filter(Boolean);

  // ── Safety algorithms ──────────────────────────────────────────────
  const drugAllergyConflicts = activeMeds.filter((m: any) => {
    const d = norm(m.drug);
    return allergyNames.some(a => d.includes(a));
  });

  const interactions: string[] = [];
  for (let i = 0; i < activeMeds.length; i++) {
    const d = norm(activeMeds[i].drug);
    for (let j = i + 1; j < activeMeds.length; j++) {
      const other = norm(activeMeds[j].drug);
      const keys = Object.keys(INTERACTIONS);
      for (const k of keys) {
        if (d.includes(k) && INTERACTIONS[k].some(t => other.includes(t))) {
          interactions.push(`${activeMeds[i].drug} ↔ ${activeMeds[j].drug} (potential interaction)`);
        }
      }
    }
  }

  const duplicates: string[] = [];
  const seen: Record<string, number> = {};
  activeMeds.forEach((m: any) => {
    const d = norm(m.drug);
    if (d) seen[d] = (seen[d] || 0) + 1;
  });
  Object.entries(seen).forEach(([d, n]) => { if (n > 1) duplicates.push(`Duplicate therapy: ${d} (${n} active prescriptions)`); });

  const polypharmacy = activeMeds.length >= 5;

  const checkAllergyConflict = (drug: string) => {
    const d = norm(drug);
    const hit = allergyNames.find(a => a && d.includes(a));
    return hit || '';
  };

  const reset = () => { setForm({ drug: '', dosage: '', quantity: '', route: '', refills: 0, note: '' }); setEditId(null); };

  const suggestedDrugs = useMemo(() => {
    const set = new Set<string>();
    (conditions || []).forEach((c: any) => {
      const d = norm(c.diagnosis || c.title);
      Object.entries(DIAGNOSIS_DRUGS).forEach(([k, drugs]) => {
        if (d.includes(k)) drugs.forEach(x => set.add(x));
      });
    });
    return [...set];
  }, [conditions]);

  const handleSubmit = async () => {
    if (!form.drug.trim()) return;
    const conflict = checkAllergyConflict(form.drug);
    if (conflict) {
      setWarn(`⚠️ Allergy conflict: "${form.drug}" may interact with recorded allergy "${conflict}".`);
      return;
    }
    const duplicate = activeMeds.some((m: any) => norm(m.drug) === norm(form.drug) && m.id !== editId);
    if (duplicate && !editId) {
      setWarn(`⚠️ Duplicate: "${form.drug}" is already on the patient's active medication list.`);
      return;
    }
    setWarn('');
    setAdding(true);
    try {
      const payload = { ...form, refills: String(form.refills) };
      if (editId) await updateMedication(patientId, editId, payload as any);
      else await createMedication(patientId, payload as any);
      reset();
      queryClient.invalidateQueries({ queryKey: ['patient', patientId, 'medications'] });
    } catch { /* ignore */ }
    finally { setAdding(false); }
  };

  const handleDelete = async (id: number) => {
    await deleteMedication(patientId, id);
    queryClient.invalidateQueries({ queryKey: ['patient', patientId, 'medications'] });
  };

  const handleEdit = (m: any) => {
    setEditId(m.id);
    setForm({ drug: m.drug || '', dosage: m.dosage || '', quantity: m.quantity || '', route: m.route || '', refills: Number(m.refills || 0), note: m.note || '' });
  };

  const filtered = search.trim()
    ? activeMeds.filter((m: any) => norm(m.drug).includes(norm(search)))
    : activeMeds;

  return (
    <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
      <div className="card-header bg-white d-flex justify-content-between align-items-center py-3" style={{ borderRadius: '16px 16px 0 0' }}>
        <h5 className="mb-0 fw-bold"><i className="bi bi-capsule me-2 text-primary"></i>Medications</h5>
        <div className="d-flex align-items-center gap-2">
          {editId && <span className="badge bg-warning rounded-pill">Editing</span>}
          <span className="badge bg-primary rounded-pill">{activeMeds.length} active</span>
        </div>
      </div>
      <div className="card-body">
        {/* Safety alerts */}
        {(drugAllergyConflicts.length > 0 || interactions.length > 0 || duplicates.length > 0 || polypharmacy) && (
          <div className="alert alert-danger py-2 small">
            <div className="fw-semibold mb-1"><i className="bi bi-shield-exclamation me-1"></i>Medication Safety Alerts</div>
            {drugAllergyConflicts.map((m: any) => (
              <div key={`a-${m.id}`}><i className="bi bi-exclamation-triangle me-1"></i>Allergy conflict: {m.drug}</div>
            ))}
            {interactions.map((t, i) => (
              <div key={`i-${i}`}><i className="bi bi-arrow-left-right me-1"></i>{t}</div>
            ))}
            {duplicates.map((t, i) => (
              <div key={`d-${i}`}><i className="bi bi-copy me-1"></i>{t}</div>
            ))}
            {polypharmacy && <div><i className="bi bi-capsule-pill me-1"></i>Polypharmacy: {activeMeds.length} active medications — review for appropriateness.</div>}
          </div>
        )}
        {warn && <div className="alert alert-warning py-2 small">{warn}</div>}

        {/* Add / edit form */}
        {!readOnly && (
          <div className="rounded-3 border p-3 mb-3" style={{ backgroundColor: '#f8f9fa' }}>
            <h6 className="fw-bold small mb-2">{editId ? 'Edit Medication' : 'Add Medication'}</h6>
            {suggestedDrugs.length > 0 && !editId && (
              <div className="d-flex align-items-center flex-wrap gap-1 mb-2">
                <small className="text-muted me-1"><i className="bi bi-stars text-warning me-1"></i>Suggested for diagnosis:</small>
                {suggestedDrugs.map((d: string) => (
                  <button key={d} type="button" className="btn btn-outline-primary btn-sm rounded-pill py-0" style={{ fontSize: '0.72rem' }}
                    onClick={() => {
                      const hit = DRUG_FORMULARY.find(x => x.name === d);
                      if (hit) setForm(prev => ({ ...prev, drug: hit.name, dosage: hit.dosage, quantity: hit.quantity, route: hit.route, refills: hit.refills }));
                      else setForm(prev => ({ ...prev, drug: d }));
                    }}>{d}</button>
                ))}
              </div>
            )}
            <div className="row g-2">
              <div className="col-md-3">
                <label className="form-label small mb-0">Drug name</label>
                <input className="form-control form-control-sm" list="drug-formulary" placeholder="Select or type a drug…" value={form.drug}
                  onChange={e => {
                    const name = e.target.value;
                    const hit = DRUG_FORMULARY.find(d => d.name.toLowerCase() === name.trim().toLowerCase());
                    setForm(prev => hit
                      ? { ...prev, drug: hit.name, dosage: hit.dosage, quantity: hit.quantity, route: hit.route, refills: hit.refills }
                      : { ...prev, drug: name });
                  }} />
                <datalist id="drug-formulary">
                  {DRUG_FORMULARY.map(d => <option key={d.name} value={d.name} />)}
                </datalist>
              </div>
              <div className="col-md-2"><label className="form-label small mb-0">Dosage</label><input className="form-control form-control-sm" placeholder="10 mg" value={form.dosage} onChange={e => setForm({ ...form, dosage: e.target.value })} /></div>
              <div className="col-md-2"><label className="form-label small mb-0">Quantity</label><input className="form-control form-control-sm" placeholder="30" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} /></div>
              <div className="col-md-2"><label className="form-label small mb-0">Route</label>
                <select className="form-select form-select-sm" value={form.route} onChange={e => setForm({ ...form, route: e.target.value })}>
                  <option value="">—</option><option>PO</option><option>IV</option><option>IM</option><option>SC</option><option>PR</option><option>Topical</option><option>Inhalation</option>
                </select>
              </div>
              <div className="col-md-1"><label className="form-label small mb-0">Refills</label><input className="form-control form-control-sm" type="number" min={0} value={form.refills} onChange={e => setForm({ ...form, refills: Number(e.target.value) })} /></div>
              <div className="col-md-2 d-flex align-items-end gap-1">
                <button className="btn btn-primary btn-sm w-100" onClick={handleSubmit} disabled={adding || !form.drug.trim()}>
                  {adding ? <span className="spinner-border spinner-border-sm" /> : editId ? 'Update' : 'Add'}
                </button>
                {editId && <button className="btn btn-outline-secondary btn-sm" onClick={reset}>Cancel</button>}
              </div>
              <div className="col-md-12"><label className="form-label small mb-0">Note / instructions</label><input className="form-control form-control-sm" placeholder="Optional instructions…" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></div>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="input-group input-group-sm mb-3">
          <span className="input-group-text bg-white border-end-0 rounded-pill-start"><i className="bi bi-search text-muted"></i></span>
          <input className="form-control border-start-0 rounded-pill-end" placeholder="Search medications…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {filtered.length === 0 ? (
          <p className="text-muted text-center mb-0">No medications recorded.</p>
        ) : (
          <div className="list-group list-group-flush">
            {filtered.map((m: any) => {
              const hasAllergyConflict = allergyNames.some(a => norm(m.drug).includes(a));
              return (
                <div key={m.id} className="list-group-item d-flex justify-content-between align-items-start gap-2">
                  <div className="min-width-0">
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      <strong>{m.drug}</strong>
                      {hasAllergyConflict && <span className="badge bg-danger rounded-pill" title="Allergy conflict"><i className="bi bi-exclamation-triangle"></i> Allergy</span>}
                      {Number(m.active ?? 1) === 0 && <span className="badge bg-secondary rounded-pill">Inactive</span>}
                    </div>
                    <div className="text-muted small">
                      {m.dosage || '—'} · {m.route || '—'} · Qty {m.quantity || '—'} · Refills {m.refills || 0} · Since {m.start_date || '—'}
                    </div>
                    {m.note && <small className="text-muted d-block"><i className="bi bi-sticky me-1"></i>{m.note}</small>}
                  </div>
                  {!readOnly && (
                    <div className="d-flex gap-1 flex-shrink-0">
                      <button className="btn btn-outline-secondary btn-sm" onClick={() => handleEdit(m)}><i className="bi bi-pencil" /></button>
                      <button className="btn btn-outline-danger btn-sm" onClick={() => handleDelete(m.id)}><i className="bi bi-trash" /></button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
