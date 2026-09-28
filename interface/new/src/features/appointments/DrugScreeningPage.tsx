import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import nestClient from '../../api/nest-client';
import { formatDateOnly } from '../../utils/date';
import { chartPatientId } from '../../utils/patientChart';

export default function DrugScreeningPage() {
  const [count, setCount] = useState(5);
  const [selected, setSelected] = useState<any[]>([]);
  const [history, setHistory] = useState<{date:string;patients:any[];mode:string}[]>([]);
  const [mode, setMode] = useState<'random' | 'risk' | 'fair'>('random');
  const navigate = useNavigate();

  const { data: patients = [] } = useQuery({
    queryKey: ['patients', 'all'],
    queryFn: async () => { const r = await nestClient.get('/patients', { params: { limit: 100 } }); return r.data; },
  });

  // Smart algorithm: assign risk scores based on patient workflow
  const getRiskScore = (p: any): number => {
    let score = 0;
    // Higher risk: older patients
    if (p.DOB) {
      const age = new Date().getFullYear() - new Date(p.DOB).getFullYear();
      if (age > 60) score += 3;
      else if (age > 40) score += 2;
      else score += 1;
    }
    // Higher risk: male patients (statistically higher substance abuse)
    if (p.sex === 'Male') score += 1;
    // Higher risk: recently registered (need baseline)
    if (p.regdate) {
      const daysSinceReg = Math.floor((Date.now() - new Date(p.regdate).getTime())/86400000);
      if (daysSinceReg < 30) score += 2;
    }
    // Higher risk: pending status (not yet fully processed)
    if (p.status === 'pending') score += 1;
    return score;
  };

  const generateRandom = () => {
    const pool = [...patients];
    const picked: any[] = [];
    const n = Math.min(count, pool.length);

    if (mode === 'risk') {
      // Risk-weighted selection: higher risk = higher probability
      const weighted = pool.map(p => ({p, risk: getRiskScore(p)}));
      weighted.sort((a,b) => b.risk - a.risk);
      // Take top 70% by risk, then random from remainder
      const topN = Math.ceil(n * 0.7);
      const restN = n - topN;
      for (let i = 0; i < topN && i < weighted.length; i++) picked.push(weighted[i].p);
      const remaining = weighted.slice(topN).map(w => w.p);
      for (let i = 0; i < restN && remaining.length > 0; i++) {
        const idx = Math.floor(Math.random() * remaining.length);
        if (!picked.find(pp => pp.id === remaining[idx].id)) picked.push(remaining.splice(idx,1)[0]);
      }
    } else if (mode === 'fair') {
      // Fair distribution: rotate through patients, prioritize those never selected
      const allEverSelected = new Set(history.flatMap(h=>h.patients.map(p=>p.id)));
      const neverSelected = pool.filter(p=>!allEverSelected.has(p.id));
      const everSelected = pool.filter(p=>allEverSelected.has(p.id));
      const shuffledNever = [...neverSelected].sort(()=>Math.random()-0.5);
      const shuffledEver = [...everSelected].sort(()=>Math.random()-0.5);
      const combined = [...shuffledNever, ...shuffledEver];
      for (let i=0;i<n&&i<combined.length;i++) picked.push(combined[i]);
    } else {
      // Pure random
      for (let i = 0; i < n; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        picked.push(pool.splice(idx, 1)[0]);
      }
    }

    setSelected(picked);
    setHistory(prev => [{date:new Date().toLocaleDateString(),patients:picked,mode},...prev].slice(0,10));
  };

  return (
    <div>
      <div className="rounded-4 p-4 mb-4 text-white" style={{background:'linear-gradient(135deg, #dc3545 0%, #fd7e14 50%, #ffc107 100%)'}}>
        <div className="d-flex justify-content-between align-items-start">
          <div>
            <h2 className="mb-1 fw-bold"><i className="bi bi-shuffle me-2"></i>Smart Drug Screening</h2>
            <p className="mb-0 text-white text-opacity-75 small">
              Pool: {patients.length} patients · {selected.length} selected · {history.length > 0 ? `${history[0].date} — ${history[0].mode} mode` : 'No history'}
            </p>
          </div>
        </div>
      </div>

      {/* Smart Stats */}
      <div className="row g-3 mb-4">
        {[
          {v:patients.length,l:'Total Pool',c:'#0d6efd',i:'bi-people'},
          {v:history.reduce((s,h)=>s+h.patients.length,0),l:'Total Screened',c:'#198754',i:'bi-check-circle'},
          {v:patients.filter((p:any)=>getRiskScore(p)>=5).length,l:'High Risk',c:'#dc3545',i:'bi-exclamation-triangle'},
          {v:history.length,l:'Sessions',c:'#6f42c1',i:'bi-calendar-check'},
        ].map((s,i)=>(
          <div className="col-md-3 col-sm-6" key={i}>
            <div className="card border-0 shadow-sm h-100" style={{borderRadius:'16px'}}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0" style={{width:'48px',height:'48px',backgroundColor:`${s.c}15`}}>
                  <i className={`bi ${s.i} fs-5`} style={{color:s.c}}></i>
                </div>
                <div><div className="fs-4 fw-bold" style={{color:s.c}}>{s.v}</div><small className="text-muted">{s.l}</small></div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="card border-0 shadow-sm mb-4" style={{borderRadius:'16px'}}>
        <div className="card-body">
          <div className="row g-3 align-items-end">
            <div className="col-md-2">
              <label className="form-label small fw-semibold">Algorithm</label>
              <div className="btn-group w-100">
                {[
                  {v:'random' as const,l:'🎲 Random',c:'#0d6efd'},
                  {v:'risk' as const,l:'⚠️ Risk',c:'#dc3545'},
                  {v:'fair' as const,l:'⚖️ Fair',c:'#198754'},
                ].map(a=>(
                  <button key={a.v} className={`btn btn-sm ${mode===a.v?'text-white':'btn-outline-secondary'}`}
                    style={mode===a.v?{backgroundColor:a.c}:{}}
                    onClick={()=>setMode(a.v)}>{a.l}</button>
                ))}
              </div>
            </div>
            <div className="col-md-3">
              <label className="form-label small fw-semibold">Count: <strong>{count}</strong></label>
              <input type="range" className="form-range" min={1} max={Math.min(30,patients.length)} value={count} onChange={e=>setCount(Number(e.target.value))} />
            </div>
            <div className="col-md-2">
              <label className="form-label small fw-semibold">Pool</label>
              <div className="form-control bg-light rounded-pill text-center fw-bold">{patients.length}</div>
            </div>
            <div className="col-md-3">
              <button className="btn rounded-pill w-100 text-white fw-bold" style={{background:'linear-gradient(135deg,#dc3545,#fd7e14)'}}
                onClick={generateRandom} disabled={patients.length===0}>
                <i className="bi bi-shuffle me-1"></i>Run Algorithm
              </button>
            </div>
            <div className="col-md-2">
              {selected.length>0&&<button className="btn btn-outline-secondary rounded-pill w-100" onClick={()=>setSelected([])}>
                <i className="bi bi-x-circle me-1"></i>Clear</button>}
            </div>
          </div>
          <div className="mt-2">
            <small className="text-muted">
              {mode==='random'?'🎲 Pure random selection from all patients':
               mode==='risk'?'⚠️ Weighted by age, sex, registration recency, and status':
               '⚖️ Prioritizes patients never selected before, then rotates through the rest'}
            </small>
          </div>
        </div>
      </div>

      {/* Risk Distribution */}
      {patients.length>0&&mode==='risk'&&(
        <div className="card border-0 shadow-sm mb-4" style={{borderRadius:'16px'}}>
          <div className="card-header bg-white py-3"><h6 className="mb-0 fw-bold"><i className="bi bi-bar-chart me-2 text-danger"></i>Risk Distribution</h6></div>
          <div className="card-body">
            <div className="row g-2">
              {[
                {l:'Low (1-2)',c:'#198754',f:(p:any)=>getRiskScore(p)<=2},
                {l:'Medium (3-4)',c:'#ffc107',f:(p:any)=>getRiskScore(p)>=3&&getRiskScore(p)<=4},
                {l:'High (5+)',c:'#dc3545',f:(p:any)=>getRiskScore(p)>=5},
              ].map(r=>{
                const cnt = patients.filter(r.f).length;
                const pct = patients.length>0?Math.round(cnt/patients.length*100):0;
                return (
                  <div className="col-4" key={r.l}>
                    <div className="text-center p-2 rounded-3" style={{backgroundColor:`${r.c}15`}}>
                      <div className="fw-bold" style={{color:r.c}}>{cnt}</div>
                      <small className="text-muted">{r.l} ({pct}%)</small>
                      <div className="progress mt-1" style={{height:'6px'}}>
                        <div className="progress-bar" style={{width:`${pct}%`,backgroundColor:r.c}}></div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Selected Patients */}
      {selected.length>0&&(
        <div className="card border-0 shadow-sm mb-4" style={{borderRadius:'16px',borderLeft:'4px solid #fd7e14'}}>
          <div className="card-header bg-white d-flex justify-content-between py-3" style={{borderRadius:'16px 16px 0 0'}}>
            <h6 className="mb-0 fw-bold"><i className="bi bi-clipboard-check me-2" style={{color:'#fd7e14'}}></i>Selected ({selected.length})</h6>
            <span className="badge bg-light text-dark rounded-pill">{new Date().toLocaleDateString()} · {mode} mode</span>
          </div>
          <div className="card-body p-0">
            <div className="row g-0">
              {selected.map((p:any,i:number)=>{
                const risk = getRiskScore(p);
                return (
                  <div key={p.id} className="col-md-4 col-sm-6 border-bottom border-end p-3" style={{cursor:'pointer'}}
                    onClick={()=>{ const cid = chartPatientId(p.id, p.pid); if (cid) navigate(`/patients/${cid}`); }}>
                    <div className="d-flex align-items-center gap-3">
                      <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                        style={{width:'44px',height:'44px',backgroundColor:risk>=5?'#dc354515':risk>=3?'#ffc10715':'#19875415'}}>
                        <span className="fw-bold" style={{color:risk>=5?'#dc3545':risk>=3?'#ffc107':'#198754'}}>{i+1}</span>
                      </div>
                      <div className="flex-grow-1">
                        <div className="fw-bold small">{p.lname}, {p.fname}</div>
                        <small className="text-muted">PID #{p.pid} · {formatDateOnly(p.DOB)} · {p.sex||'—'}</small>
                        <div className="mt-1">
                          <span className={`badge rounded-pill ${risk>=5?'bg-danger':risk>=3?'bg-warning text-dark':'bg-success'}`} style={{fontSize:'0.65rem'}}>
                            Risk: {risk}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Selection History */}
      {history.length>0&&(
        <div className="card border-0 shadow-sm" style={{borderRadius:'16px'}}>
          <div className="card-header bg-white py-3" style={{borderRadius:'16px 16px 0 0'}}>
            <h6 className="mb-0 fw-bold"><i className="bi bi-clock-history me-2 text-info"></i>Selection History</h6>
          </div>
          <div className="card-body p-0">
            {history.map((h,i)=>(
              <div key={i} className="px-3 py-2 border-bottom small">
                <div className="d-flex justify-content-between mb-1">
                  <span className="fw-semibold">{h.date}</span>
                  <span className={`badge ${h.mode==='risk'?'bg-danger':h.mode==='fair'?'bg-success':'bg-secondary'}`}>{h.mode}</span>
                </div>
                <div className="text-muted">{h.patients.length} patients</div>
                <div className="d-flex flex-wrap gap-1 mt-1">
                  {h.patients.map(p=><span key={p.id} className="badge bg-light text-dark">{p.lname},{p.fname[0]}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {selected.length===0&&!history.length&&(
        <div className="text-center py-5 text-muted">
          <i className="bi bi-shuffle opacity-50" style={{fontSize:'4rem'}}></i>
          <p className="mt-3">Choose an algorithm, adjust the count, and run the selection</p>
        </div>
      )}
    </div>
  );
}
