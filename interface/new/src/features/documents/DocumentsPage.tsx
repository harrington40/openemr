import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';

interface DocumentItem {
  id: number; originalName: string; mimeType: string; sizeBytes: number;
  b2FileId: string; pid: number; category: string; status: string;
  notes: string; accessCount: number; plainCode?: string;
  uploadedBy: string; recipientContact: string; recipientName: string;
  createdAt: string; updatedAt: string;
}

const CATEGORIES = [
  { value: 'general', label: 'General', icon: 'bi-folder', color: '#6c757d' },
  { value: 'lab', label: 'Lab Results', icon: 'bi-flask', color: '#0d6efd' },
  { value: 'imaging', label: 'Imaging', icon: 'bi-image', color: '#6f42c1' },
  { value: 'referral', label: 'Referral', icon: 'bi-send', color: '#fd7e14' },
  { value: 'consent', label: 'Consent Form', icon: 'bi-file-earmark-check', color: '#198754' },
  { value: 'discharge', label: 'Discharge', icon: 'bi-file-earmark-arrow-up', color: '#0dcaf0' },
  { value: 'prescription', label: 'Prescription', icon: 'bi-capsule', color: '#dc3545' },
  { value: 'insurance', label: 'Insurance', icon: 'bi-shield', color: '#002868' },
  { value: 'registration', label: 'Registration', icon: 'bi-person-plus', color: '#20c997' },
  { value: 'billing', label: 'Billing', icon: 'bi-cash-stack', color: '#C8102E' },
];

const STATUS_LABELS: Record<string, { label: string; badge: string }> = {
  pending: { label: 'Pending', badge: 'bg-warning text-dark' },
  accepted: { label: 'Accepted', badge: 'bg-success' },
  rejected: { label: 'Rejected', badge: 'bg-danger' },
  expired: { label: 'Expired', badge: 'bg-secondary' },
};

const fm = (bytes: number) => bytes<1024?`${bytes}B`:bytes<1048576?`${(bytes/1024).toFixed(1)}KB`:`${(bytes/1048576).toFixed(1)}MB`;
const fd = (d: string) => new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});

export default function DocumentsPage() {
  const qc = useQueryClient();
  const fi = useRef<HTMLInputElement>(null);
  const [pid, setPid] = useState('');
  const [view, setView] = useState<'all'|'my'|'upload'>('all');
  const [catFilter, setCatFilter] = useState('');
  const [uf, setUf] = useState<File|null>(null);
  const [uPid, setUPid] = useState('');
  const [uCat, setUCat] = useState('general');
  const [uNotes, setUNotes] = useState('');
  const [uRes, setURes] = useState<any>(null);
  const [uErr, setUErr] = useState('');
  const [selDoc, setSelDoc] = useState<DocumentItem|null>(null);
  const [ac, setAc] = useState('');
  const [acErr, setAcErr] = useState('');
  const [acOk, setAcOk] = useState('');

  const { data: docs=[] } = useQuery<DocumentItem[]>({
    queryKey: ['documents', pid],
    queryFn: async () => { const r = await nestClient.get('/documents',{params:pid?{pid}:{}}); return r.data; },
  });

  const { data: myDocs=[] } = useQuery<DocumentItem[]>({
    queryKey: ['my-documents', pid],
    queryFn: async () => { const r = await nestClient.get('/documents/my',{params:pid?{pid}:{}}); return r.data; },
    enabled: view==='my',
  });

  const uploadMut = useMutation({
    mutationFn: async () => {
      if(!uf) throw new Error('No file');
      const fd = new FormData(); fd.append('file',uf);
      if(uPid) fd.append('pid',uPid);
      fd.append('category',uCat);
      if(uNotes) fd.append('notes',uNotes);
      const r = await nestClient.post('/documents/upload',fd,{headers:{'Content-Type':'multipart/form-data'}});
      return r.data;
    },
    onSuccess: (d) => { setURes(d); setUErr(''); qc.invalidateQueries({queryKey:['documents']}); qc.invalidateQueries({queryKey:['my-documents']}); },
    onError: (e:any) => setUErr(e.response?.data?.message||'Upload failed'),
  });

  const verifyMut = useMutation({
    mutationFn: async ({id,code}:{id:number;code:string}) => { const r=await nestClient.post(`/documents/${id}/verify`,{code}); return r.data; },
    onSuccess: (d) => {
      if(d.valid){ setAcOk('Verified! Opening...'); setAcErr(''); if(d.downloadUrl&&!d.downloadUrl.startsWith('local://')) window.open(d.downloadUrl,'_blank'); qc.invalidateQueries({queryKey:['documents']}); qc.invalidateQueries({queryKey:['my-documents']}); }
      else { setAcErr('Invalid code'); setAcOk(''); }
    },
    onError: () => setAcErr('Verification failed'),
  });

  const displayDocs = view==='my' ? myDocs : docs;
  const filtered = catFilter ? displayDocs.filter((d:DocumentItem) => d.category===catFilter) : displayDocs;
  const byCat: Record<string, number> = {}; displayDocs.forEach((d:DocumentItem) => { byCat[d.category] = (byCat[d.category]||0)+1; });
  const totalSize = displayDocs.reduce((s:number,d:DocumentItem)=>s+d.sizeBytes,0);

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
      <div className="rounded-4 p-4 mb-4 text-white position-relative" style={{background:'linear-gradient(135deg, #0d6efd 0%, #6610f2 50%, #6f42c1 100%)', zIndex: 1}}>
        <div className="d-flex justify-content-between align-items-start">
          <div>
            <h2 className="mb-1 fw-bold"><i className="bi bi-cloud-upload me-2"></i>Secure Documents</h2>
            <p className="mb-0 text-white text-opacity-75 small">Backblaze B2 · 4-digit codes · Smart Patient Linking</p>
          </div>
          <div className="btn-group btn-group-sm">
            <button className={`btn ${view==='all'?'btn-light':'btn-outline-light'}`} onClick={()=>setView('all')}><i className="bi bi-list-ul me-1"></i>All</button>
            <button className={`btn ${view==='my'?'btn-light':'btn-outline-light'}`} onClick={()=>setView('my')}><i className="bi bi-person-badge me-1"></i>Mine</button>
            <button className={`btn ${view==='upload'?'btn-light':'btn-outline-light'}`} onClick={()=>setView('upload')}><i className="bi bi-cloud-arrow-up me-1"></i>Upload</button>
          </div>
        </div>
      </div>

      {/* Smart Stats */}
      <div className="row g-3 mb-4">
        {[
          {v:displayDocs.length,l:'Total Documents',c:'#0d6efd',i:'bi-folder2'},
          {v:fm(totalSize),l:'Storage Used',c:'#6610f2',i:'bi-hdd'},
          {v:Object.keys(byCat).length,l:'Categories',c:'#198754',i:'bi-tags'},
          {v:displayDocs.filter((d:DocumentItem)=>d.status==='pending').length,l:'Pending Review',c:'#fd7e14',i:'bi-hourglass-split'},
        ].map((s,i)=>(
          <div className="col-md-3 col-sm-6" key={i}>
            <div className="card border-0 shadow-sm h-100" style={{borderRadius:'16px'}}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0" style={{width:'48px',height:'48px',backgroundColor:`${s.c}15`}}>
                  <i className={`bi ${s.i} fs-5`} style={{color:s.c}}></i>
                </div>
                <div><div className="fs-5 fw-bold" style={{color:s.c}}>{s.v}</div><small className="text-muted">{s.l}</small></div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Smart Category Pills */}
      <div className="d-flex flex-wrap gap-1 mb-3">
        <button className={`btn btn-sm rounded-pill ${!catFilter?'btn-primary':'btn-outline-secondary'}`} onClick={()=>setCatFilter('')}>All</button>
        {CATEGORIES.map(c=>(
          <button key={c.value} className={`btn btn-sm rounded-pill ${catFilter===c.value?'btn-primary':'btn-outline-secondary'}`}
            onClick={()=>setCatFilter(catFilter===c.value?'':c.value)}>
            <i className={`bi ${c.icon} me-1`}></i>{c.label}
            {byCat[c.value]>0 && <span className="badge bg-light text-dark ms-1">{byCat[c.value]}</span>}
          </button>
        ))}
      </div>

      {/* Patient ID Filter */}
      <div className="row g-2 mb-3">
        <div className="col-md-3"><input className="form-control form-control-sm rounded-pill" placeholder="Filter by Patient ID" value={pid} onChange={e=>setPid(e.target.value)} /></div>
      </div>

      {/* Upload View */}
      {view==='upload' && (
        <div className="row g-3">
          <div className="col-lg-7">
            <div className="card border-0 shadow-sm" style={{borderRadius:'16px'}}>
              <div className="card-header bg-white py-3"><h6 className="mb-0 fw-bold"><i className="bi bi-file-earmark-arrow-up me-2"></i>Upload Document</h6></div>
              <div className="card-body">
                {!uRes ? (<>
                  <div className="mb-3"><label className="form-label small">Select File</label>
                    <input ref={fi} type="file" className="form-control" onChange={e=>{const f=e.target.files?.[0]; if(f){setUf(f);setURes(null);}}} accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.dcm,.txt,.csv" />
                    {uf && <div className="mt-2 small text-muted"><i className="bi bi-paperclip me-1"></i>{uf.name} ({fm(uf.size)})</div>}
                  </div>
                  <div className="row g-2 mb-3">
                    <div className="col-md-6"><label className="form-label small">Category</label>
                      <select className="form-select form-select-sm" value={uCat} onChange={e=>setUCat(e.target.value)}>
                        {CATEGORIES.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}
                      </select></div>
                    <div className="col-md-6"><label className="form-label small">Patient ID</label>
                      <input className="form-control form-control-sm" placeholder="e.g. 1" value={uPid} onChange={e=>setUPid(e.target.value)} /></div>
                  </div>
                  <div className="mb-3"><label className="form-label small">Notes</label><textarea className="form-control form-control-sm" rows={2} value={uNotes} onChange={e=>setUNotes(e.target.value)} /></div>
                  <button className="btn rounded-pill px-4 text-white" style={{background:'linear-gradient(135deg,#0d6efd,#6610f2)'}}
                    onClick={()=>uploadMut.mutate()} disabled={!uf||uploadMut.isPending}>
                    {uploadMut.isPending?<><span className="spinner-border spinner-border-sm me-1"></span>Uploading...</>:<><i className="bi bi-cloud-upload me-1"></i>Upload & Secure</>}
                  </button>
                  {uErr && <div className="alert alert-danger small mt-2 mb-0">{uErr}</div>}
                </>) : (
                  <div className="text-center py-3">
                    <i className="bi bi-check-circle text-success" style={{fontSize:'3rem'}}></i>
                    <h5>Uploaded!</h5>
                    <p className="small text-muted">{uRes.originalName}</p>
                    <div className="card bg-primary bg-opacity-10 mx-auto mb-3" style={{maxWidth:'260px',borderRadius:'16px'}}>
                      <div className="card-body text-center py-3">
                        <small className="text-muted">ACCESS CODE</small>
                        <span className="d-block fw-bold text-primary" style={{fontSize:'2.2rem',letterSpacing:'0.3em',fontFamily:'monospace'}}>{uRes.accessCode}</span>
                      </div>
                    </div>
                    <button className="btn btn-outline-primary btn-sm me-2 rounded-pill" onClick={()=>navigator.clipboard.writeText(uRes.accessCode)}><i className="bi bi-clipboard me-1"></i>Copy</button>
                    <button className="btn btn-primary btn-sm rounded-pill" onClick={()=>{setUf(null);setURes(null);if(fi.current)fi.current.value='';}}><i className="bi bi-plus-circle me-1"></i>Upload Another</button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="col-lg-5">
            <div className="card border-0 shadow-sm" style={{borderRadius:'16px'}}>
              <div className="card-header bg-white py-3"><h6 className="mb-0 fw-bold"><i className="bi bi-cpu me-2 text-info"></i>Smart Document Links</h6></div>
              <div className="card-body small">
                <p className="text-muted mb-2">Link documents to patient workflows:</p>
                {[
                  {c:'registration',t:'Registration — Attach ID cards, consent forms'},
                  {c:'lab',t:'Lab Results — CBC, metabolic panels, malaria tests'},
                  {c:'billing',t:'Billing — Invoices, NHIS claims, receipts'},
                  {c:'insurance',t:'Insurance — Policy documents, NHIS cards'},
                  {c:'imaging',t:'Imaging — X-rays, ultrasound, DICOM'},
                  {c:'prescription',t:'Prescriptions — eRx records, pharmacy orders'},
                ].map((l,i)=>(
                  <div key={i} className="d-flex gap-2 mb-1 align-items-center">
                    <i className={`bi ${CATEGORIES.find(c=>c.value===l.c)?.icon||'bi-file'}`} style={{color:CATEGORIES.find(c=>c.value===l.c)?.color}}></i>
                    <span>{l.t}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Document Table */}
      {view!=='upload' && (
        <div className="card border-0 shadow-sm" style={{borderRadius:'16px'}}>
          <div className="card-header bg-white d-flex justify-content-between py-3">
            <h6 className="mb-0 fw-bold"><i className="bi bi-files me-2"></i>{view==='my'?'My Documents':'All Documents'}</h6>
            <span className="badge rounded-pill bg-primary">{filtered.length}</span>
          </div>
          <div className="card-body p-0">
            <table className="table table-hover mb-0 small">
              <thead className="table-light"><tr><th>Document</th><th>Category</th><th>Patient</th><th>Status</th>{view==='my'&&<th>Code</th>}<th>Uploaded</th><th></th></tr></thead>
              <tbody>
                {filtered.map((doc:DocumentItem)=>{
                  const cat = CATEGORIES.find(c=>c.value===doc.category);
                  return (
                    <tr key={doc.id}>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <i className={`bi ${doc.mimeType.includes('pdf')?'bi-file-pdf text-danger':doc.mimeType.includes('image')?'bi-file-image text-info':'bi-file-earmark text-secondary'}`}></i>
                          <div><div className="fw-semibold">{doc.originalName}</div><small className="text-muted">{fm(doc.sizeBytes)}</small></div>
                        </div>
                      </td>
                      <td><span className="badge small" style={{backgroundColor:`${cat?.color||'#6c757d'}20`,color:cat?.color,border:`1px solid ${cat?.color}`}}>{cat?.label||doc.category}</span></td>
                      <td>{doc.pid?<span>#{doc.pid}</span>:<span className="text-muted">—</span>}</td>
                      <td><span className={`badge small rounded-pill ${STATUS_LABELS[doc.status]?.badge||'bg-secondary'}`}>{STATUS_LABELS[doc.status]?.label||doc.status}</span></td>
                      {view==='my'&&<td>{doc.plainCode?<span className="fw-bold text-primary" style={{fontFamily:'monospace',cursor:'pointer'}} onClick={()=>navigator.clipboard.writeText(doc.plainCode!)}>{doc.plainCode}</span>:<span className="text-muted">—</span>}</td>}
                      <td><small>{doc.uploadedBy||'—'}</small><br/><small className="text-muted">{fd(doc.createdAt)}</small></td>
                      <td><button className="btn btn-outline-primary btn-sm rounded-pill" onClick={()=>{setSelDoc(doc);setAc('');setAcErr('');setAcOk('');}}><i className="bi bi-unlock me-1"></i>View</button></td>
                    </tr>
                  );
                })}
                {filtered.length===0 && <tr><td colSpan={view==='my'?7:6} className="text-center text-muted py-5">
                  <i className="bi bi-cloud-upload fs-1 d-block mb-2 opacity-50"></i><p>No documents found</p>
                  <button className="btn btn-primary btn-sm rounded-pill" onClick={()=>setView('upload')}><i className="bi bi-plus-circle me-1"></i>Upload</button>
                </td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Code Modal */}
      {selDoc && (
        <div className="modal d-block" tabIndex={-1} style={{backgroundColor:'rgba(0,0,0,0.5)'}}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow" style={{borderRadius:'16px'}}>
              <div className="modal-header text-white py-2" style={{background:'linear-gradient(135deg,#0d6efd,#6610f2)',borderRadius:'16px 16px 0 0'}}>
                <h6 className="modal-title"><i className="bi bi-lock-fill me-2"></i>Secure Access</h6>
                <button className="btn-close btn-close-white" onClick={()=>{setSelDoc(null);setAcErr('');setAcOk('');}}></button>
              </div>
              <div className="modal-body text-center py-4">
                <i className="bi bi-file-earmark-lock" style={{fontSize:'3rem',color:'#6610f2'}}></i>
                <h6 className="mt-2">{selDoc.originalName}</h6>
                {acOk ? <div className="alert alert-success small">{acOk}</div> : <>
                  <input type="text" className="form-control form-control-lg text-center mx-auto my-3"
                    style={{fontSize:'2rem',letterSpacing:'0.5em',fontFamily:'monospace',maxWidth:'200px'}}
                    maxLength={4} placeholder="0000" value={ac}
                    onChange={e=>{const v=e.target.value.replace(/\D/g,'').slice(0,4);setAc(v);setAcErr('');}}
                    onKeyDown={e=>{if(e.key==='Enter'&&ac.length===4) verifyMut.mutate({id:selDoc.id,code:ac});}} autoFocus />
                  {acErr && <div className="alert alert-danger small py-2">{acErr}</div>}
                  <button className="btn rounded-pill px-4 text-white" style={{background:'linear-gradient(135deg,#0d6efd,#6610f2)'}}
                    onClick={()=>verifyMut.mutate({id:selDoc.id,code:ac})} disabled={ac.length!==4||verifyMut.isPending}>
                    {verifyMut.isPending?<><span className="spinner-border spinner-border-sm me-1"></span>Verifying...</>:<><i className="bi bi-unlock me-1"></i>Unlock</>}
                  </button>
                </>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
