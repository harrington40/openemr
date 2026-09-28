import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';
import { useInvalidateNotifications } from '../../hooks/useNotifications';

const CATEGORIES = [
  { key: 'drugs', label: 'Drugs', icon: 'bi-capsule', desc: 'FDA drug labels, adverse events, recalls' },
  { key: 'devices', label: 'Devices', icon: 'bi-cpu', desc: 'Medical device classifications, recalls' },
  { key: 'food', label: 'Food', icon: 'bi-egg-fried', desc: 'Food recalls, adverse events' },
  { key: 'cosmetics', label: 'Cosmetics', icon: 'bi-palette', desc: 'Cosmetic product safety data' },
  { key: 'tobacco', label: 'Tobacco', icon: 'bi-exclamation-triangle', desc: 'Tobacco product problem reports' },
  { key: 'other', label: 'Other', icon: 'bi-box', desc: 'Other FDA-regulated substances' },
  { key: 'transparency', label: 'Transparency', icon: 'bi-eye', desc: 'FDA inspections, warning letters, compliance' },
];

export default function FdaLookupPage() {
  const [category, setCategory] = useState('drugs');
  const [searchTerm, setSearchTerm] = useState('');
  const [smartSearch, setSmartSearch] = useState('');

  // Drug info notices raised from FDA lookups (badge + detail modal).
  const qc = useQueryClient();
  const invalidateNotifications = useInvalidateNotifications();
  const raised = useRef<Set<string>>(new Set());
  const [openNotice, setOpenNotice] = useState<any>(null);

  const { data: drugInfoData } = useQuery<any>({
    queryKey: ['drug-info-notifications'],
    queryFn: async () => {
      const r = await nestClient.get('/notifications/drug-info', { params: { limit: 25 } });
      return r.data || { unread: 0, notifications: [] };
    },
    refetchInterval: 30000,
  });
  const drugNotices: any[] = drugInfoData?.notifications || [];
  const drugUnread: number = drugInfoData?.unread || 0;

  const raiseNotice = useMutation({
    mutationFn: (payload: any) => nestClient.post('/notifications/drug-info', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drug-info-notifications'] });
      invalidateNotifications();
    },
  });

  const ackNotice = useMutation({
    mutationFn: (id: number) => nestClient.post(`/notifications/drug-info/${id}/ack`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drug-info-notifications'] });
      invalidateNotifications();
    },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['fda', category, searchTerm],
    queryFn: async () => {
      if (!searchTerm.trim()) return null;
      const r = await nestClient.get(`/fda/${category}`, { params: { term: searchTerm, limit: 10 } });
      return r.data;
    },
    enabled: searchTerm.length >= 2,
  });

  const { data: smartData, isLoading: smartLoading } = useQuery({
    queryKey: ['fda-smart', smartSearch],
    queryFn: async () => {
      if (!smartSearch.trim()) return null;
      const [drugRes] = await Promise.all([
        nestClient.get('/fda/smart/drug', { params: { drug: smartSearch } }),
      ]);
      return { drug: drugRes.data };
    },
    enabled: smartSearch.length >= 2,
  });

  // When a looked-up drug is actually prescribed to patients, raise a notice so
  // the drug information (and its specifics) is visible next to Drug Info.
  // Only prescribed drugs raise a notice, and each drug is raised once per
  // session, so browsing the FDA data does not spam the inbox.
  useEffect(() => {
    const drug = smartData?.drug;
    const name = drug?.drugName;
    if (!drug || !name || !(drug.patientCount > 0)) return;
    const key = String(name).toLowerCase();
    if (raised.current.has(key)) return;
    raised.current.add(key);

    const allergy = drug.allergyWarnings || [];
    const interactions = drug.interactionWarnings || [];
    raiseNotice.mutate({
      drug: name,
      summary:
        `${drug.patientCount} patient(s) prescribed this drug` +
        (allergy.length ? ` · ${allergy.length} allergy warning(s)` : '') +
        (interactions.length ? ` · ${interactions.length} interaction warning(s)` : ''),
      details: {
        drugName: name,
        patientCount: drug.patientCount,
        patientsOnDrug: drug.patientsOnDrug || [],
        allergyWarnings: allergy,
        interactionWarnings: interactions,
        topAdverseReactions: (drug.topAdverseReactions || []).slice(0, 10),
        label: drug.fda
          ? {
              brandName: drug.fda.openfda?.brand_name?.[0] || null,
              genericName: drug.fda.openfda?.generic_name?.[0] || null,
              manufacturer: drug.fda.openfda?.manufacturer_name?.[0] || null,
              route: drug.fda.openfda?.route?.[0] || null,
              warnings: drug.fda.warnings?.[0] || null,
              dosage: drug.fda.dosage_and_administration?.[0] || null,
              indications: drug.fda.indications_and_usage?.[0] || null,
              adverseReactions: drug.fda.adverse_reactions?.[0] || null,
            }
          : null,
      },
    });
    // raiseNotice is a stable mutation handle; re-running on it would duplicate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartData]);

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

      <div className="rounded-4 p-4 mb-4 text-white position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0d6efd 0%, #198754 60%, #00c9a7 100%)', zIndex: 1 }}>
        <div className="position-absolute end-0 top-0 opacity-10" style={{ fontSize: '6rem', transform: 'rotate(10deg) translate(20px,-10px)' }}><i className="bi bi-shield-check"></i></div>
        <div className="position-relative">
          <h3 className="mb-1 fw-bold"><i className="bi bi-shield-check me-2"></i>FDA Regulatory Lookup</h3>
          <p className="mb-0 text-white text-opacity-75 small">Search FDA databases for drug labels, device recalls, food safety, and more — powered by openFDA.gov</p>
        </div>
      </div>

      {/* Drug information notices — raised when a prescribed drug is looked up */}
      {drugNotices.length > 0 && (
        <div className="card shadow-sm mb-3" style={{ position: 'relative', zIndex: 1 }}>
          <div className="card-header bg-white d-flex justify-content-between align-items-center py-2">
            <h6 className="mb-0 fw-bold">
              <i className="bi bi-bell-fill me-2 text-danger"></i>Drug Information Notices
              {drugUnread > 0 && <span className="badge bg-danger rounded-pill ms-2">{drugUnread} new</span>}
            </h6>
            <small className="text-muted" style={{ fontSize: '0.65rem' }}>{drugNotices.length} recent</small>
          </div>
          <div className="card-body p-0">
            {drugNotices.slice(0, 4).map((n: any) => {
              const isNew = String(n.status || '').toLowerCase() === 'new';
              return (
                <div key={n.id} className="d-flex align-items-center gap-2 px-3 py-2 border-bottom"
                  style={{ cursor: 'pointer', background: isNew ? '#dc35450a' : 'transparent' }}
                  onClick={() => setOpenNotice(n)}>
                  <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                    style={{ width: '30px', height: '30px', backgroundColor: isNew ? '#dc354520' : '#6c757d20' }}>
                    <i className={`bi bi-capsule ${isNew ? 'text-danger' : 'text-secondary'}`}></i>
                  </div>
                  <div className="flex-grow-1 min-w-0">
                    <div className={`small text-truncate ${isNew ? 'fw-bold' : 'text-muted'}`}>
                      {n.drug}{n.patientName ? ` · ${n.patientName}` : ''}
                    </div>
                    <small className="text-muted d-block text-truncate" style={{ fontSize: '0.65rem' }}>{n.summary}</small>
                  </div>
                  <small className="text-muted flex-shrink-0" style={{ fontSize: '0.6rem' }}>
                    {n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}
                  </small>
                  <i className="bi bi-chevron-right text-muted small"></i>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Category Tabs */}
      <div className="d-flex flex-wrap gap-1 mb-3">
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            className={`btn btn-sm ${category === cat.key ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setCategory(cat.key)}
            title={cat.desc}
          >
            <i className={`bi ${cat.icon} me-1`}></i>{cat.label}
          </button>
        ))}
      </div>

      <div className="row g-3">
        {/* Simple Search */}
        <div className="col-md-7">
          <div className="card shadow-sm">
            <div className="card-header bg-white py-2">
              <h6 className="mb-0"><i className="bi bi-search me-2"></i>Search {CATEGORIES.find(c => c.key === category)?.label}</h6>
            </div>
            <div className="card-body">
              <div className="input-group mb-3">
                <input
                  className="form-control"
                  placeholder={`Search ${category}...`}
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
                <button className="btn btn-primary" disabled={!searchTerm}>
                  <i className="bi bi-search"></i>
                </button>
              </div>

              {isLoading && <div className="text-center py-3"><div className="spinner-border spinner-border-sm text-primary"/></div>}
              {error && <div className="alert alert-danger small">Failed to fetch FDA data</div>}

              {data?.results?.length > 0 && (
                <div>
                  <small className="text-muted">{data.total || data.results.length} results</small>
                  {data.results.slice(0, 10).map((r: any, i: number) => (
                    <div key={i} className="card bg-light mb-2 border-0">
                      <div className="card-body py-2 small">
                        {r.brandName && <div><strong>{r.brandName}</strong> {r.genericName && <span className="text-muted">({r.genericName})</span>}</div>}
                        {r.device_name && <div><strong>{r.device_name}</strong></div>}
                        {r.product_description && <div><strong>{r.product_description}</strong></div>}
                        {r.manufacturer && <div className="text-muted">{r.manufacturer}</div>}
                        {r.indications && <div className="mt-1"><span className="fw-semibold">Indications:</span> {r.indications.substring(0, 200)}</div>}
                        {r.warnings && <div className="mt-1 text-danger"><span className="fw-semibold">Warnings:</span> {r.warnings.substring(0, 200)}</div>}
                        {r.recall_number && <div className="mt-1"><span className="badge bg-danger me-1">Recall</span> {r.reason_for_recall?.substring(0, 150)}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {data && !data.results?.length && searchTerm.length >= 2 && (
                <p className="text-muted small">No results found for "{searchTerm}"</p>
              )}
            </div>
          </div>
        </div>

        {/* Smart Lookup */}
        <div className="col-md-5">
          <div className="card shadow-sm border-primary">
            <div className="card-header bg-primary text-white py-2">
              <h6 className="mb-0"><i className="bi bi-lightbulb me-2"></i>Smart Drug Lookup</h6>
            </div>
            <div className="card-body">
              <p className="small text-muted">Cross-references FDA data with your patients — finds interactions, allergies, and adverse events.</p>
              <div className="input-group mb-3">
                <input
                  className="form-control form-control-sm"
                  placeholder="Enter drug name..."
                  value={smartSearch}
                  onChange={e => setSmartSearch(e.target.value)}
                />
              </div>

              {smartLoading && <div className="text-center py-2"><div className="spinner-border spinner-border-sm text-primary"/></div>}

              {smartData?.drug && (
                <div className="small">
                  {smartData.drug.allergyWarnings?.length > 0 && (
                    <div className="alert alert-danger py-2 mb-2">
                      <i className="bi bi-exclamation-octagon me-1"></i>
                      {smartData.drug.allergyWarnings.map((w: string, i: number) => <div key={i}>{w}</div>)}
                    </div>
                  )}

                  {smartData.drug.interactionWarnings?.length > 0 && (
                    <div className="alert alert-warning py-2 mb-2">
                      <i className="bi bi-exclamation-triangle me-1"></i>
                      <strong>Potential Drug Interactions:</strong>
                      {smartData.drug.interactionWarnings.map((w: string, i: number) => <div key={i}>• {w}</div>)}
                    </div>
                  )}

                  <div className="mb-2">
                    <span className="badge bg-info me-1">{smartData.drug.patientCount} patients</span>
                    on this medication in the system
                  </div>

                  {smartData.drug.topAdverseReactions?.length > 0 && (
                    <div className="mt-2">
                      <strong>Top Adverse Reactions:</strong>
                      <div className="d-flex flex-wrap gap-1 mt-1">
                        {smartData.drug.topAdverseReactions.map((r: any, i: number) => (
                          <span key={i} className="badge bg-light text-dark border">{r.term} ({r.count})</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {smartData.drug.patientsOnDrug?.length > 0 && (
                    <div className="mt-3">
                      <strong>Patients on this drug:</strong>
                      {smartData.drug.patientsOnDrug.map((p: any, i: number) => (
                        <div key={i} className="text-muted">• {p.fname} {p.lname} (PID {p.pid}) — {p.dosage}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Drug information detail modal — every specific of the looked-up drug */}
      {openNotice && (
        <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
          style={{ background: 'rgba(10,37,64,0.45)', zIndex: 1080, padding: '16px' }}
          onClick={() => setOpenNotice(null)}>
          <div className="card border-0 shadow-lg"
            style={{ maxWidth: '720px', width: '100%', maxHeight: '88vh', overflow: 'auto', borderRadius: '20px' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="card-header text-white d-flex justify-content-between align-items-center py-3"
              style={{ background: 'linear-gradient(135deg, #dc3545, #0d6efd)', borderRadius: '20px 20px 0 0' }}>
              <div>
                <h6 className="mb-0 fw-bold"><i className="bi bi-capsule me-2"></i>{openNotice.drug}</h6>
                <small className="text-white text-opacity-75">
                  {openNotice.patientName ? `${openNotice.patientName} · ` : ''}
                  {openNotice.createdAt ? new Date(openNotice.createdAt).toLocaleString() : ''}
                  {openNotice.createdBy ? ` · by ${openNotice.createdBy}` : ''}
                </small>
              </div>
              <button className="btn btn-sm btn-outline-light rounded-circle" style={{ width: '32px', height: '32px' }}
                onClick={() => setOpenNotice(null)}><i className="bi bi-x-lg"></i></button>
            </div>
            <div className="card-body">
              {(openNotice.details?.allergyWarnings || []).length > 0 && (
                <div className="alert alert-danger py-2 small mb-3">
                  <strong><i className="bi bi-exclamation-octagon me-1"></i>Allergy warnings</strong>
                  {openNotice.details.allergyWarnings.map((w: string, i: number) => <div key={i}>• {w}</div>)}
                </div>
              )}
              {(openNotice.details?.interactionWarnings || []).length > 0 && (
                <div className="alert alert-warning py-2 small mb-3">
                  <strong><i className="bi bi-exclamation-triangle me-1"></i>Drug interactions</strong>
                  {openNotice.details.interactionWarnings.map((w: string, i: number) => <div key={i}>• {w}</div>)}
                </div>
              )}

              <div className="row g-2 mb-3">
                {[
                  { l: 'Patients on this drug', v: openNotice.details?.patientCount ?? 0, c: '#0d6efd' },
                  { l: 'Allergy warnings', v: (openNotice.details?.allergyWarnings || []).length, c: '#dc3545' },
                  { l: 'Interactions', v: (openNotice.details?.interactionWarnings || []).length, c: '#fd7e14' },
                ].map((s) => (
                  <div className="col-4" key={s.l}>
                    <div className="p-2 rounded-3 text-center" style={{ backgroundColor: `${s.c}12` }}>
                      <div className="fw-bold" style={{ color: s.c }}>{s.v}</div>
                      <small className="text-muted" style={{ fontSize: '0.6rem' }}>{s.l}</small>
                    </div>
                  </div>
                ))}
              </div>

              {openNotice.details?.label && (
                <>
                  <h6 className="small fw-bold text-muted text-uppercase">FDA label specifics</h6>
                  <ul className="list-unstyled small mb-3">
                    {[
                      ['Brand name', openNotice.details.label.brandName],
                      ['Generic name', openNotice.details.label.genericName],
                      ['Manufacturer', openNotice.details.label.manufacturer],
                      ['Route', openNotice.details.label.route],
                    ]
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <li key={String(k)}><span className="text-muted">{k}:</span> <strong>{v}</strong></li>
                      ))}
                  </ul>
                  {[
                    ['Indications', openNotice.details.label.indications],
                    ['Dosage & administration', openNotice.details.label.dosage],
                    ['Warnings', openNotice.details.label.warnings],
                    ['Adverse reactions', openNotice.details.label.adverseReactions],
                  ]
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div className="mb-2" key={String(k)}>
                        <strong className="small">{k}</strong>
                        <div className="text-muted small" style={{ maxHeight: '150px', overflow: 'auto' }}>{v}</div>
                      </div>
                    ))}
                </>
              )}
              {(openNotice.details?.topAdverseReactions || []).length > 0 && (
                <>
                  <h6 className="small fw-bold text-muted text-uppercase mt-3">Top adverse reactions (FDA events)</h6>
                  <div className="d-flex flex-wrap gap-1">
                    {openNotice.details.topAdverseReactions.map((r: any, i: number) => (
                      <span key={i} className="badge bg-light text-dark border">{r.term} ({r.count})</span>
                    ))}
                  </div>
                </>
              )}

              {(openNotice.details?.patientsOnDrug || []).length > 0 && (
                <>
                  <h6 className="small fw-bold text-muted text-uppercase mt-3">Patients prescribed this drug</h6>
                  <div className="small">
                    {openNotice.details.patientsOnDrug.map((p: any, i: number) => (
                      <div key={i} className="text-muted">• {p.fname} {p.lname} (PID {p.pid}) — {p.dosage}</div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="card-footer bg-white text-end" style={{ borderRadius: '0 0 20px 20px' }}>
              {String(openNotice.status || '').toLowerCase() === 'new' && (
                <button className="btn btn-outline-secondary btn-sm rounded-pill me-2"
                  disabled={ackNotice.isPending}
                  onClick={() => { ackNotice.mutate(openNotice.id); setOpenNotice(null); }}>
                  Mark read
                </button>
              )}
              <button className="btn btn-primary btn-sm rounded-pill" onClick={() => setOpenNotice(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
