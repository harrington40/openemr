import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';

interface Props {
  patientId?: string;
  patientName?: string;
  onSelectDrug?: (drug: any) => void;
}

export default function DrugInformationPanel({ patientId: _patientId, patientName, onSelectDrug }: Props) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'search' | 'details' | 'interactions' | 'safety' | 'rxnorm' | 'recalls'>('search');
  const [selectedDrug, setSelectedDrug] = useState<string>('');

  const { data: searchResults, isLoading, refetch } = useQuery({
    queryKey: ['fda-drug-search', search],
    queryFn: async () => {
      if (!search.trim()) return null;
      const r = await nestClient.get('/fda/drugs', { params: { term: search, limit: 8 } });
      return r.data;
    },
    enabled: false,
  });

  const { data: smartData } = useQuery({
    queryKey: ['fda-smart-drug', selectedDrug],
    queryFn: async () => {
      if (!selectedDrug) return null;
      const r = await nestClient.get('/fda/smart/drug', { params: { drug: selectedDrug } });
      return r.data;
    },
    enabled: !!selectedDrug,
  });

  // FDA Recalls
  const { data: recallsData } = useQuery({
    queryKey: ['fda-recalls', selectedDrug],
    queryFn: async () => {
      if (!selectedDrug) return null;
      const r = await nestClient.get('/fda/drugs/recalls', { params: { drug: selectedDrug, limit: 15 } });
      return r.data;
    },
    enabled: !!selectedDrug && activeTab === 'recalls',
  });

  // RxNorm smart lookup
  const { data: rxnormData } = useQuery({
    queryKey: ['rxnav-lookup', selectedDrug],
    queryFn: async () => {
      if (!selectedDrug) return null;
      const r = await nestClient.get(`/fda/rxnav/lookup/${encodeURIComponent(selectedDrug)}`);
      return r.data;
    },
    enabled: !!selectedDrug && activeTab === 'rxnorm',
  });

  const handleSearch = () => {
    if (search.trim()) {
      refetch();
      setActiveTab('search');
    }
  };

  const handleDrugSelect = (drug: any) => {
    setSelectedDrug(drug.brandName || drug.genericName);
    setActiveTab('details');
    onSelectDrug?.(drug);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div className="card shadow-sm h-100">
      {/* Header with Search */}
      <div className="card-header bg-gradient text-white py-3" style={{ background: 'linear-gradient(135deg, #0d6efd 0%, #6610f2 100%)' }}>
        <div className="d-flex align-items-center justify-content-between mb-2">
          <h5 className="mb-0">
            <i className="bi bi-capsule me-2"></i>
            Drug Information
          </h5>
          <span className="badge bg-white bg-opacity-25">openFDA + RxNorm</span>
        </div>
        <div className="input-group">
          <span className="input-group-text bg-white border-0">
            <i className="bi bi-search"></i>
          </span>
          <input
            type="text"
            className="form-control border-0"
            placeholder="Search by brand or generic name (e.g., Lipitor, metformin)..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button className="btn btn-light" onClick={handleSearch} disabled={isLoading}>
            {isLoading ? (
              <span className="spinner-border spinner-border-sm"></span>
            ) : (
              <i className="bi bi-arrow-right"></i>
            )}
          </button>
        </div>
        {patientName && (
          <small className="text-white text-opacity-75 mt-1 d-block">
            <i className="bi bi-person me-1"></i>Context: {patientName}
          </small>
        )}
      </div>

      {/* Tabs */}
      <div className="card-body p-0">
        <ul className="nav nav-tabs px-3 pt-2">
          <li className="nav-item">
            <button className={`nav-link small ${activeTab === 'search' ? 'active' : ''}`} onClick={() => setActiveTab('search')}>
              <i className="bi bi-search me-1"></i>Results
              {searchResults?.results?.length > 0 && (
                <span className="badge bg-primary ms-1">{searchResults.results.length}</span>
              )}
            </button>
          </li>
          <li className="nav-item">
            <button className={`nav-link small ${activeTab === 'details' ? 'active' : ''}`} onClick={() => setActiveTab('details')} disabled={!selectedDrug}>
              <i className="bi bi-info-circle me-1"></i>Details
            </button>
          </li>
          <li className="nav-item">
            <button className={`nav-link small ${activeTab === 'interactions' ? 'active' : ''}`} onClick={() => setActiveTab('interactions')} disabled={!selectedDrug}>
              <i className="bi bi-arrow-left-right me-1"></i>Interactions
              {smartData?.interactionWarnings?.length > 0 && (
                <span className="badge bg-warning text-dark ms-1">{smartData.interactionWarnings.length}</span>
              )}
            </button>
          </li>
          <li className="nav-item">
            <button className={`nav-link small ${activeTab === 'safety' ? 'active' : ''}`} onClick={() => setActiveTab('safety')} disabled={!selectedDrug}>
              <i className="bi bi-shield-exclamation me-1"></i>Safety
            </button>
          </li>
          <li className="nav-item">
            <button className={`nav-link small ${activeTab === 'rxnorm' ? 'active' : ''}`} onClick={() => setActiveTab('rxnorm')} disabled={!selectedDrug}>
              <i className="bi bi-diagram-3 me-1"></i>RxNorm
            </button>
          </li>
          <li className="nav-item">
            <button className={`nav-link small ${activeTab === 'recalls' ? 'active' : ''}`} onClick={() => setActiveTab('recalls')} disabled={!selectedDrug}>
              <i className="bi bi-exclamation-diamond me-1"></i>Recalls
            </button>
          </li>
        </ul>

        <div className="p-3" style={{ maxHeight: 'calc(100vh - 300px)', overflowY: 'auto' }}>
          {/* Search Results Tab */}
          {activeTab === 'search' && (
            <>
              {!searchResults && !isLoading && (
                <div className="text-center text-muted py-5">
                  <i className="bi bi-capsule" style={{ fontSize: '3rem' }}></i>
                  <p className="mt-3">Search for a drug to see FDA label information,<br/>adverse events, and patient-specific interactions.</p>
                  <div className="d-flex gap-2 justify-content-center mt-2">
                    {['aspirin', 'Lipitor', 'metformin', 'lisinopril', 'omeprazole'].map(q => (
                      <button key={q} className="btn btn-outline-secondary btn-sm" onClick={() => { setSearch(q); setTimeout(() => refetch(), 100); }}>
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {searchResults?.error && (
                <div className="alert alert-warning py-2 small">
                  <i className="bi bi-exclamation-triangle me-1"></i>
                  FDA API unavailable. Showing local data only.
                </div>
              )}
              {searchResults?.results?.map((drug: any, i: number) => (
                <div
                  key={i}
                  className="card mb-2 border-start border-primary"
                  style={{ borderLeftWidth: '4px', cursor: 'pointer' }}
                  onClick={() => handleDrugSelect(drug)}
                >
                  <div className="card-body py-2 px-3">
                    <div className="d-flex justify-content-between align-items-start">
                      <div>
                        <h6 className="mb-0">{drug.brandName}</h6>
                        <small className="text-muted">{drug.genericName}</small>
                      </div>
                      <span className="badge bg-light text-dark small">{drug.route || 'N/A'}</span>
                    </div>
                    <div className="d-flex gap-2 mt-1">
                      <small className="text-muted"><i className="bi bi-building me-1"></i>{drug.manufacturer}</small>
                    </div>
                    {drug.indications && (
                      <p className="small text-muted mt-1 mb-0" style={{ lineHeight: '1.3' }}>
                        <strong>Use:</strong> {drug.indications.substring(0, 150)}...
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Details Tab */}
          {activeTab === 'details' && smartData?.fda && (
            <div>
              <div className="d-flex align-items-center gap-2 mb-3">
                <span className="rounded-circle bg-primary d-flex align-items-center justify-content-center text-white" style={{ width: '40px', height: '40px', fontSize: '1.2rem' }}>
                  <i className="bi bi-capsule"></i>
                </span>
                <div>
                  <h5 className="mb-0">{smartData.fda.brandName}</h5>
                  <small className="text-muted">{smartData.fda.genericName} · {smartData.fda.manufacturer}</small>
                </div>
              </div>

              <div className="row g-2 mb-3">
                <div className="col-4">
                  <div className="card bg-light">
                    <div className="card-body text-center py-2">
                      <div className="fw-bold text-primary">{smartData.patientCount}</div>
                      <small className="text-muted">Patients on this drug</small>
                    </div>
                  </div>
                </div>
                <div className="col-4">
                  <div className="card bg-light">
                    <div className="card-body text-center py-2">
                      <div className="fw-bold text-warning">{smartData.interactionWarnings?.length || 0}</div>
                      <small className="text-muted">Interactions</small>
                    </div>
                  </div>
                </div>
                <div className="col-4">
                  <div className="card bg-light">
                    <div className="card-body text-center py-2">
                      <div className="fw-bold text-danger">{smartData.allergyWarnings?.length || 0}</div>
                      <small className="text-muted">Allergy Alerts</small>
                    </div>
                  </div>
                </div>
              </div>

              {smartData.fda.indications && (
                <div className="mb-3">
                  <h6 className="text-primary"><i className="bi bi-bullseye me-1"></i>Indications</h6>
                  <p className="small text-muted">{smartData.fda.indications.substring(0, 500)}</p>
                </div>
              )}

              {smartData.fda.dosage && (
                <div className="mb-3">
                  <h6 className="text-primary"><i className="bi bi-droplet me-1"></i>Dosage & Administration</h6>
                  <p className="small text-muted">{smartData.fda.dosage.substring(0, 400)}</p>
                </div>
              )}

              {smartData.fda.warnings && (
                <div className="mb-3">
                  <h6 className="text-danger"><i className="bi bi-exclamation-triangle me-1"></i>Warnings</h6>
                  <p className="small bg-danger bg-opacity-10 p-2 rounded">{smartData.fda.warnings.substring(0, 500)}</p>
                </div>
              )}
            </div>
          )}

          {/* Interactions Tab */}
          {activeTab === 'interactions' && (
            <div>
              <h6 className="mb-3"><i className="bi bi-arrow-left-right me-1"></i>Drug Interactions</h6>
              {smartData?.interactionWarnings?.length > 0 ? (
                smartData.interactionWarnings.map((w: string, i: number) => (
                  <div key={i} className="alert alert-warning py-2 small mb-2">
                    <i className="bi bi-exclamation-triangle me-1"></i>{w}
                  </div>
                ))
              ) : (
                <div className="text-center text-muted py-3">
                  <i className="bi bi-check-circle text-success fs-4"></i>
                  <p className="mt-1 mb-0">No known interactions found in patient records.</p>
                </div>
              )}
              {smartData?.allergyWarnings?.length > 0 && (
                <>
                  <h6 className="mb-3 mt-3"><i className="bi bi-shield-exclamation me-1"></i>Allergy Alerts</h6>
                  {smartData.allergyWarnings.map((w: string, i: number) => (
                    <div key={i} className="alert alert-danger py-2 small mb-2">
                      {w}
                    </div>
                  ))}
                </>
              )}
              {smartData?.patientsOnDrug?.length > 0 && (
                <>
                  <h6 className="mb-2 mt-3">Patients on {selectedDrug}</h6>
                  <div className="table-responsive">
                    <table className="table table-sm small">
                      <thead><tr><th>Name</th><th>Dosage</th><th>Since</th></tr></thead>
                      <tbody>
                        {smartData.patientsOnDrug.map((p: any, i: number) => (
                          <tr key={i}>
                            <td>{p.fname} {p.lname}</td>
                            <td>{p.dosage || 'N/A'}</td>
                            <td>{p.start_date || 'N/A'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Safety Tab */}
          {activeTab === 'safety' && (
            <div>
              <h6 className="mb-3"><i className="bi bi-shield-exclamation me-1"></i>Adverse Reactions</h6>
              {smartData?.topAdverseReactions?.length > 0 ? (
                <div className="row g-2">
                  {smartData.topAdverseReactions.map((r: any, i: number) => (
                    <div key={i} className="col-6">
                      <div className="d-flex align-items-center gap-2 p-2 bg-light rounded small">
                        <span className="badge bg-danger">{r.count}</span>
                        <span>{r.term}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted small">No adverse event data available.</div>
              )}
              {smartData?.fda?.adverseReactions && (
                <div className="mt-3">
                  <h6>Reported Reactions</h6>
                  <p className="small text-muted">{smartData.fda.adverseReactions}</p>
                </div>
              )}
            </div>
          )}

          {/* RxNorm Tab */}
          {activeTab === 'rxnorm' && (
            <div>
              <div className="d-flex align-items-center gap-2 mb-3">
                <span className="badge bg-info fs-6">NIH</span>
                <h6 className="mb-0">RxNorm Standardized Drug Data</h6>
              </div>
              {rxnormData?.found === false ? (
                <div>
                  <div className="alert alert-warning py-2 small">
                    <i className="bi bi-exclamation-triangle me-1"></i>
                    No exact RxNorm match found for "{rxnormData.drugName}"
                  </div>
                  {rxnormData.suggestions?.length > 0 && (
                    <>
                      <h6>Did you mean?</h6>
                      {rxnormData.suggestions.map((s: any, i: number) => (
                        <button
                          key={i}
                          className="btn btn-outline-info btn-sm me-1 mb-1"
                          onClick={() => { setSelectedDrug(s.name); setActiveTab('rxnorm'); }}
                        >
                          {s.name} ({Math.round(s.score)}%)
                        </button>
                      ))}
                    </>
                  )}
                </div>
              ) : rxnormData ? (
                <div>
                  {/* Primary concept */}
                  <div className="card bg-info bg-opacity-10 mb-3">
                    <div className="card-body py-2">
                      <div className="d-flex justify-content-between align-items-center">
                        <div>
                          <strong>{rxnormData.primary?.name}</strong>
                          <div className="small text-muted">
                            RxCUI: <code>{rxnormData.primary?.rxcui}</code> · Type: {rxnormData.primary?.tty}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Properties */}
                  {rxnormData.properties && (
                    <div className="mb-3">
                      <h6 className="text-info"><i className="bi bi-info-circle me-1"></i>Properties</h6>
                      <div className="row g-2 small">
                        {Object.entries(rxnormData.properties).filter(([k]) => !['rxcui','name','synonym'].includes(k)).map(([key, val]: any) => (
                          <div key={key} className="col-6">
                            <span className="text-muted">{key.replace(/([A-Z])/g, ' $1').trim()}:</span>{' '}
                            <strong>{String(val)}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Drug Classes */}
                  {rxnormData.drugClasses?.length > 0 && (
                    <div className="mb-3">
                      <h6 className="text-info"><i className="bi bi-tags me-1"></i>Drug Classes</h6>
                      <div className="d-flex flex-wrap gap-1">
                        {rxnormData.drugClasses.map((c: any, i: number) => (
                          <span key={i} className="badge bg-secondary small">
                            {c.className} ({c.classType})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Active Ingredients */}
                  {rxnormData.ingredients?.length > 0 && (
                    <div className="mb-3">
                      <h6 className="text-info"><i className="bi bi-flask me-1"></i>Active Ingredients</h6>
                      <div className="d-flex flex-wrap gap-1">
                        {rxnormData.ingredients.map((ing: any, i: number) => (
                          <span key={i} className="badge bg-primary bg-opacity-25 text-dark small">
                            {ing.name} <code className="text-muted">{ing.rxcui}</code>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Branded & Clinical Forms */}
                  {rxnormData.brandedForms?.length > 0 && (
                    <div className="mb-3">
                      <h6 className="text-info"><i className="bi bi-capsule me-1"></i>Available Forms</h6>
                      <div className="list-group list-group-flush small">
                        {rxnormData.brandedForms.map((f: any, i: number) => (
                          <div key={i} className="list-group-item py-1 px-2 d-flex justify-content-between">
                            <span>{f.name}</span>
                            <span className="badge bg-light text-dark">{f.tty}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* All Related Concepts */}
                  {rxnormData.allRelated?.length > 0 && (
                    <div className="mb-3">
                      <h6 className="text-info"><i className="bi bi-diagram-3 me-1"></i>All RxNorm Concepts</h6>
                      <div className="small text-muted mb-1">Showing {rxnormData.allRelated.length} related concepts</div>
                      <div className="row g-1">
                        {rxnormData.allRelated.map((r: any, i: number) => (
                          <div key={i} className="col-6">
                            <small>
                              <code className="text-muted">{r.rxcui}</code> {r.name}
                              <span className="badge bg-light text-dark ms-1" style={{ fontSize: '0.6rem' }}>{r.tty}</span>
                            </small>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center text-muted py-3">
                  <div className="spinner-border spinner-border-sm text-info mb-2"></div>
                  <p className="small">Loading RxNorm data...</p>
                </div>
              )}
            </div>
          )}

          {/* Recalls Tab */}
          {activeTab === 'recalls' && (
            <div>
              <h6 className="mb-3"><i className="bi bi-exclamation-diamond me-1 text-danger"></i>FDA Drug Recall History</h6>
              {recallsData?.results?.length > 0 ? (
                <div className="table-responsive">
                  <table className="table table-sm small">
                    <thead className="table-light">
                      <tr><th>Date</th><th>Product</th><th>Reason</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {recallsData.results.map((r: any, i: number) => (
                        <tr key={i}>
                          <td><small>{r.recall_initiation_date || '—'}</small></td>
                          <td><strong className="small">{r.product_description || '—'}</strong></td>
                          <td><small className="text-muted">{r.reason_for_recall?.substring(0, 100) || '—'}</small></td>
                          <td>
                            <span className={`badge rounded-pill ${r.status === 'Ongoing' ? 'bg-danger' : r.status === 'Completed' ? 'bg-success' : r.status === 'Terminated' ? 'bg-secondary' : 'bg-warning text-dark'}`}>
                              {r.status || 'Unknown'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center text-muted py-3">
                  <i className="bi bi-check-circle text-success fs-4"></i>
                  <p className="mt-1 mb-0">No active recalls found for this drug.</p>
                  <small className="text-muted">Data sourced from FDA Enforcement Reports</small>
                </div>
              )}
              <div className="mt-3 small text-muted">
                <i className="bi bi-info-circle me-1"></i>
                Recall data from <strong>openFDA.gov</strong> — Drug Enforcement Reports. Last checked: today.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
