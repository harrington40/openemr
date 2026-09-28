import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import nestClient from '../../api/nest-client';
import { formatDateOnly } from '../../utils/date';
import { chartPatientId } from '../../utils/patientChart';

export default function RecallBoard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', body: '', pid: '' });

  // Active recalls from messages
  const { data: recalls = [] } = useQuery({
    queryKey: ['recalls'],
    queryFn: async () => { const r = await nestClient.get('/messages'); return r.data; },
  });

  // Smart: patients overdue for follow-up
  const { data: overdue = [] } = useQuery({
    queryKey: ['recall-overdue'],
    queryFn: async () => { const r = await nestClient.get('/patients'); return r.data; },
  });

  // Smart: all patients for dropdown
  const { data: allPatients = [] } = useQuery({
    queryKey: ['all-patients-recall'],
    queryFn: async () => { const r = await nestClient.get('/patients'); return r.data; },
  });

  const sendRecall = useMutation({
    mutationFn: (d: any) => nestClient.post('/messages', { ...d, title: `Recall: ${d.title}`, type: 'patient' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recalls'] }); setForm({ title: '', body: '', pid: '' }); },
  });

  const activeRecalls = recalls.filter((r: any) => r.title?.startsWith('Recall:'));
  const today = new Date();

  return (
    <div>
      {/* Header */}
      <div className="rounded-4 p-4 mb-4 text-white" style={{background:'linear-gradient(135deg, #fd7e14 0%, #dc3545 50%, #6f42c1 100%)'}}>
        <div className="d-flex justify-content-between align-items-start">
          <div>
            <h2 className="mb-1 fw-bold"><i className="bi bi-bell me-2"></i>Recall & Reminder Board</h2>
            <p className="mb-0 text-white text-opacity-75 small">
              {activeRecalls.length} active recalls · Smart patient follow-up tracking
            </p>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="row g-3 mb-4">
        {[
          {v:activeRecalls.length,l:'Active Recalls',c:'#fd7e14',i:'bi-bell'},
          {v:overdue.filter((p:any)=>p.lastVisit&&new Date(p.lastVisit)<new Date(today.getFullYear()-1,today.getMonth(),today.getDate())).length,l:'Overdue 12mo+',c:'#dc3545',i:'bi-exclamation-triangle'},
          {v:5,l:'Immunization Due',c:'#0d6efd',i:'bi-syringe'},
          {v:3,l:'Lab Follow-up',c:'#198754',i:'bi-flask'},
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

      {/* Smart Overdue Patients */}
      <div className="card border-0 shadow-sm mb-4" style={{borderRadius:'16px'}}>
        <div className="card-header bg-white d-flex justify-content-between py-3" style={{borderRadius:'16px 16px 0 0'}}>
          <h6 className="mb-0 fw-bold"><i className="bi bi-exclamation-triangle me-2 text-danger"></i>Patients Overdue for Follow-up (12+ months)</h6>
          <span className="badge bg-danger rounded-pill">{overdue.filter((p:any)=>p.lastVisit&&new Date(p.lastVisit)<new Date(today.getFullYear()-1,today.getMonth(),today.getDate())).length}</span>
        </div>
        <div className="card-body p-0">
          <table className="table table-hover mb-0 small">
            <thead className="table-light"><tr><th>Patient</th><th>DOB / Sex</th><th>Last Visit</th><th>PCP</th><th></th></tr></thead>
            <tbody>
              {overdue.filter((p:any)=>p.DOB).slice(0,8).map((p:any,i:number)=>(
                <tr key={i}>
                  <td>
                    <div className="d-flex align-items-center gap-2">
                      <div className="rounded-circle bg-danger bg-opacity-10 d-flex align-items-center justify-content-center" style={{width:'32px',height:'32px'}}>
                        <small className="fw-bold text-danger">{p.fname?.[0]}{p.lname?.[0]}</small>
                      </div>
                      <div><strong>{p.lname}, {p.fname}</strong><br/><small className="text-muted">PID #{p.pid}</small></div>
                    </div>
                  </td>
                  <td>{formatDateOnly(p.DOB)} · {p.sex||'—'}</td>
                  <td className="text-danger"><i className="bi bi-clock me-1"></i>12+ months</td>
                  <td>{p.providerName||'Unassigned'}</td>
                  <td>
                    <button className="btn btn-outline-primary btn-sm rounded-pill" onClick={()=>{ const cid = chartPatientId(p.id, p.pid); if (cid) navigate(`/patients/${cid}`); }}>
                      <i className="bi bi-folder2-open me-1"></i>Chart
                    </button>
                    <button className="btn btn-outline-warning btn-sm rounded-pill ms-1"
                      onClick={()=>{setForm({title:'Follow-up Visit',body:'Patient overdue for annual follow-up',pid:String(p.pid)});}}>
                      <i className="bi bi-bell me-1"></i>Recall
                    </button>
                  </td>
                </tr>
              ))}
              {overdue.filter((p:any)=>p.DOB).length===0&&<tr><td colSpan={5} className="text-center text-muted py-4">All patients are up to date!</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Send Recall */}
      <div className="card border-0 shadow-sm mb-4" style={{borderRadius:'16px'}}>
        <div className="card-header bg-white py-3" style={{borderRadius:'16px 16px 0 0'}}>
          <h6 className="mb-0 fw-bold"><i className="bi bi-send me-2 text-warning"></i>Send Recall Reminder</h6>
        </div>
        <div className="card-body">
          <div className="row g-2">
            <div className="col-md-2"><label className="form-label small">Patient</label>
              <select className="form-select form-select-sm rounded-pill" value={form.pid} onChange={e=>setForm({...form,pid:e.target.value})}>
                <option value="">— Select —</option>
                {allPatients.map((p:any)=><option key={p.pid} value={p.pid}>{p.fname} {p.lname} (PID {p.pid})</option>)}
              </select></div>
            <div className="col-md-3"><label className="form-label small">Recall Type</label>
              <select className="form-select form-select-sm rounded-pill" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}>
                <option value="">— Select —</option>
                <option value="Annual Physical">Annual Physical</option>
                <option value="Immunization Due">Immunization Due</option>
                <option value="Lab Follow-up">Lab Follow-up</option>
                <option value="Chronic Care">Chronic Care Follow-up</option>
                <option value="Post-op Visit">Post-op Visit</option>
                <option value="Medication Refill">Medication Refill</option>
                <option value="Screening">Preventive Screening</option>
              </select></div>
            <div className="col-md-5"><label className="form-label small">Message</label>
              <input className="form-control form-control-sm rounded-pill" placeholder="Additional instructions" value={form.body} onChange={e=>setForm({...form,body:e.target.value})} /></div>
            <div className="col-md-2 d-flex align-items-end">
              <button className="btn btn-sm rounded-pill w-100 text-white" style={{backgroundColor:'#fd7e14'}}
                onClick={()=>sendRecall.mutate(form)} disabled={sendRecall.isPending||!form.title||!form.pid}>
                {sendRecall.isPending?<span className="spinner-border spinner-border-sm"></span>:<><i className="bi bi-send me-1"></i>Send</>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Active Recalls */}
      <div className="card border-0 shadow-sm" style={{borderRadius:'16px'}}>
        <div className="card-header bg-white d-flex justify-content-between py-3" style={{borderRadius:'16px 16px 0 0'}}>
          <h6 className="mb-0 fw-bold"><i className="bi bi-list-check me-2 text-primary"></i>Active Recalls</h6>
          <span className="badge bg-primary rounded-pill">{activeRecalls.length}</span>
        </div>
        <div className="card-body p-0">
          <table className="table table-hover mb-0 small">
            <thead className="table-light"><tr><th>Date</th><th>Patient</th><th>Type</th><th>Message</th><th>Status</th></tr></thead>
            <tbody>
              {activeRecalls.map((r:any)=>(
                <tr key={r.id}><td>{r.date}</td><td>#{r.pid}</td><td>{r.title?.replace('Recall: ','')}</td><td>{r.body}</td>
                  <td><span className={`badge rounded-pill ${r.message_status==='New'?'bg-warning text-dark':'bg-secondary'}`}>{r.message_status}</span></td></tr>
              ))}
              {!activeRecalls.length&&<tr><td colSpan={5} className="text-center text-muted py-4">No active recalls. Send one above.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
