import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createAllergy, deleteAllergy } from '../../../api/endpoints/allergies';
import nestClient from '../../../api/nest-client';

interface Props { patientId: string; allergies: any[]; enriched?: any[]; readOnly?: boolean }

interface Suggestion { name: string; source: string }

const SOURCE_LABEL: Record<string, { text: string; tone: string; title: string }> = {
  'fda-label': { text: 'FDA', tone: '#0d6efd', title: 'openFDA drug label' },
  rxnorm: { text: 'RxNorm', tone: '#6f42c1', title: 'RxNorm concept' },
  known: { text: 'Common', tone: '#6c757d', title: 'Common allergen / drug class' },
};

/**
 * High-yield known allergens drawn from common drug classes and FDA/RxNorm
 * terminology. Shown as quick picks when the field is empty — anything typed is
 * looked up in the FDA drug APIs instead of this list.
 */
const KNOWN_ALLERGENS = [
  'Penicillins', 'Amoxicillin', 'Ampicillin', 'Penicillin G',
  'Cephalosporins', 'Ceftriaxone', 'Cefalexin',
  'Sulfonamides', 'Sulfamethoxazole / Trimethoprim', 'Sulfasalazine',
  'Tetracyclines', 'Doxycycline',
  'Macrolides', 'Azithromycin', 'Erythromycin',
  'Quinolones', 'Ciprofloxacin', 'Levofloxacin',
  'NSAIDs', 'Ibuprofen', 'Naproxen', 'Diclofenac', 'Aspirin',
  'Opioids', 'Morphine', 'Codeine', 'Tramadol',
  'Acetaminophen',
  'Insulin', 'Metformin',
  'ACE Inhibitors', 'Lisinopril', 'Enalapril',
  'Statins', 'Atorvastatin', 'Simvastatin',
  'Anticonvulsants', 'Carbamazepine', 'Phenytoin', 'Lamotrigine',
  'Iodinated Contrast', 'Gadolinium',
  'Latex', 'Egg', 'Peanut', 'Shellfish', 'Wheat', 'Soy', 'Milk',
];

export default function AllergiesTab({ patientId, allergies, enriched = [], readOnly = false }: Props) {
  const queryClient = useQueryClient();
  const [allergen, setAllergen] = useState('');
  const [reaction, setReaction] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [debounced, setDebounced] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounce: the FDA lookup is a third-party call, so it must not fire per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(allergen.trim()), 300);
    return () => clearTimeout(t);
  }, [allergen]);

  // Drug names from the medication/FDA API (openFDA labels + RxNorm), proxied by
  // the backend — the browser cannot call openFDA directly (CORS, and it must not
  // hold a key).
  const { data: fdaResults = [], isFetching: searching } = useQuery({
    queryKey: ['drug-suggest', debounced],
    queryFn: async () => {
      try {
        const r = await nestClient.get('/fda/drugs/suggest', { params: { term: debounced, limit: 12 } });
        return (r.data?.results || []) as Suggestion[];
      } catch {
        return [];
      }
    },
    enabled: debounced.length >= 2,
    staleTime: 60_000,
  });

  const suggestions = useMemo<Suggestion[]>(() => {
    const q = debounced.toLowerCase();
    const seen = new Set<string>();
    const out: Suggestion[] = [];
    const add = (name: string, source: string) => {
      const key = String(name || '').toLowerCase();
      if (!key || seen.has(key) || key === q) return;
      seen.add(key);
      out.push({ name, source });
    };
    (fdaResults as Suggestion[]).forEach((r) => add(r.name, r.source || 'fda-label'));
    KNOWN_ALLERGENS.filter((a) => !q || a.toLowerCase().includes(q)).forEach((a) => add(a, 'known'));
    return out.slice(0, 12);
  }, [debounced, fdaResults]);

  // Close the suggestion list when the click lands outside the field.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const showList = open && !readOnly && allergen.trim().length >= 2;

  const pick = (name: string) => {
    setAllergen(name);
    setOpen(false);
    setHighlight(-1);
  };

  const handleAdd = async () => {
    const name = allergen.trim();
    if (!name) return;
    setAdding(true);
    setError('');
    try {
      await createAllergy(patientId, { allergen: name, reaction: reaction.trim() });
      setAllergen('');
      setReaction('');
      setOpen(false);
      setHighlight(-1);
      // Refresh the whole chart tree, not one key: the allergy table, the count in
      // the side menu, the readiness score and the safety-alert banner each read
      // this through a different query.
      queryClient.invalidateQueries({ queryKey: ['patient'] });
    } catch (e: any) {
      // Never fail silently — a clinician must know the allergy was NOT recorded.
      setError(e?.response?.data?.message || 'Could not add the allergy — nothing was saved. Please try again.');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: number) => {
    setError('');
    try {
      await deleteAllergy(patientId, id);
      queryClient.invalidateQueries({ queryKey: ['patient'] });
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not remove the allergy.');
    }
  };

  return (
    <div className="card">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h5 className="mb-0"><i className="bi bi-exclamation-triangle me-2"></i>Allergies</h5>
      </div>
      <div className="card-body">
        {!readOnly && (
          <>
            <div className="row g-2 align-items-start mb-2">
              <div className="col-md-5">
                <div className="position-relative" ref={boxRef}>
                  <input
                    className="form-control form-control-sm"
                    placeholder="Search a drug or allergen (FDA / RxNorm)…"
                    autoComplete="off"
                    role="combobox"
                    aria-label="Search drug or allergen"
                    aria-expanded={showList}
                    aria-controls="allergen-suggestions"
                    value={allergen}
                    onChange={e => { setAllergen(e.target.value); setOpen(true); setHighlight(-1); }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={e => {
                      if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight(h => Math.min(h + 1, suggestions.length - 1)); }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, -1)); }
                      else if (e.key === 'Escape') { setOpen(false); }
                      else if (e.key === 'Enter' && highlight >= 0 && suggestions[highlight]) {
                        e.preventDefault();
                        pick(suggestions[highlight].name);
                      }
                    }}
                  />
                  {showList && (
                    <div className="list-group shadow-sm position-absolute w-100"
                      id="allergen-suggestions" role="listbox"
                      style={{ zIndex: 1050, maxHeight: '240px', overflowY: 'auto', top: '100%', left: 0 }}>
                      {searching && suggestions.length === 0 && (
                        <div className="list-group-item small text-muted py-2">
                          <span className="spinner-border spinner-border-sm me-2"></span>Searching FDA drug data…
                        </div>
                      )}
                      {!searching && suggestions.length === 0 && (
                        <div className="list-group-item small text-muted py-2">
                          No FDA match for “{allergen.trim()}” — you can still add it as typed.
                        </div>
                      )}
                      {suggestions.map((s, i) => {
                        const badge = SOURCE_LABEL[s.source] || SOURCE_LABEL.known;
                        return (
                          <button key={s.name} type="button" role="option" aria-selected={i === highlight}
                            className={`list-group-item list-group-item-action d-flex align-items-center gap-2 py-1 ${i === highlight ? 'active' : ''}`}
                            onMouseEnter={() => setHighlight(i)}
                            onClick={() => pick(s.name)}>
                            <span className="small text-truncate">{s.name}</span>
                            <span className="badge rounded-pill ms-auto" title={badge.title}
                              style={{ backgroundColor: `${badge.tone}22`, color: badge.tone, fontSize: '0.6rem' }}>
                              {badge.text}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="col-md-5">
                <input className="form-control form-control-sm" placeholder="Reaction (e.g. Hives)"
                  aria-label="Reaction" value={reaction} onChange={e => setReaction(e.target.value)} />
              </div>
              <div className="col-md-2">
                <button className="btn btn-primary btn-sm w-100" onClick={handleAdd}
                  disabled={adding || !allergen.trim()}>
                  {adding ? <span className="spinner-border spinner-border-sm"/> : 'Add'}
                </button>
              </div>
            </div>

            {error && (
              <div className="alert alert-danger py-1 px-2 small rounded-3 mb-2">
                <i className="bi bi-exclamation-circle me-1"></i>{error}
              </div>
            )}

            {!allergen.trim() && (
              <div className="mb-3">
                <div className="small text-muted mb-1">
                  <i className="bi bi-lightbulb me-1"></i>
                  Common allergens — click to select, or type to search the FDA drug database:
                </div>
                <div className="d-flex flex-wrap gap-1">
                  {KNOWN_ALLERGENS.slice(0, 16).map(s => (
                    <button
                      type="button"
                      key={s}
                      className="btn btn-sm btn-outline-secondary rounded-pill py-0"
                      style={{ fontSize: '0.75rem' }}
                      onClick={() => { setAllergen(s); setOpen(false); }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {enriched.filter((a: any) => a.source && a.source !== 'recorded').length > 0 && (
          <div className="mb-3">
            <div className="small text-muted mb-1"><i className="bi bi-magic me-1"></i>Auto-detected from clinical notes & medications</div>
            <div className="d-flex flex-wrap gap-1">
              {enriched.filter((a: any) => a.source && a.source !== 'recorded').map((a: any, i: number) => (
                <span key={i} className="badge bg-warning bg-opacity-10 text-dark border" title={a.reaction || ''}>
                  {a.allergen} <i className={`bi ms-1 ${a.source === 'note' ? 'bi-journal-text' : 'bi-capsule'}`}></i>
                </span>
              ))}
            </div>
          </div>
        )}
        {allergies.length === 0 ? (
          <p className="text-muted text-center mb-0">No allergies recorded.</p>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm table-hover mb-0">
              <thead><tr><th>Allergen</th><th>Reaction</th><th>Date</th><th></th></tr></thead>
              <tbody>
                {allergies.map((a: any) => (
                  <tr key={a.id}><td><strong>{a.allergen || a.title}</strong></td><td>{a.reaction || '—'}</td><td>{a.date || '—'}</td>
                    <td>{!readOnly && <button className="btn btn-outline-danger btn-sm" onClick={() => handleDelete(a.id)}><i className="bi bi-trash"/></button>}</td>
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
