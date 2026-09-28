import { useAuth } from '../../hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import nestClient from '../../api/nest-client';
import { formatPatientNameLastFirst } from '../../utils/patientName';
import { chartPatientId } from '../../utils/patientChart';
import { toDateInput } from '../../utils/date';

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const today = toDateInput(new Date());

  const { data: patientStats } = useQuery({
    queryKey: ['dashboard', 'patients'],
    queryFn: async () => { const r = await nestClient.get('/reports/patients'); return r.data; },
  });
  const { data: financialStats } = useQuery({
    queryKey: ['dashboard', 'financial'],
    queryFn: async () => { const r = await nestClient.get('/reports/financial'); return r.data; },
  });
  const { data: appointments = [] } = useQuery({
    queryKey: ['dashboard', 'appointments', today],
    queryFn: async () => { const r = await nestClient.get('/appointments', { params: { date: today } }); return r.data; },
  });
  const { data: messages = [] } = useQuery({
    queryKey: ['dashboard', 'messages'],
    queryFn: async () => { const r = await nestClient.get('/messages'); return r.data; },
  });
  const { data: pendingPatients = [] } = useQuery({
    queryKey: ['patients-pending'],
    queryFn: async () => { const r = await nestClient.get('/patients/pending'); return r.data; },
  });
  const { data: inventorySummary } = useQuery({
    queryKey: ['inventory', 'dashboard'],
    queryFn: async () => { const r = await nestClient.get('/inventory/dashboard'); return r.data; },
  });

  const newMsgs = messages.filter((m:any) => m.message_status === 'New').length;
  const checkedIn = appointments.filter((a:any) => a.pc_apptstatus === 'Checked In').length;
  const totalPatients = patientStats?.total || 0;
  const totalEncounters = financialStats?.encounterCount || 0;

  const quickActions = [
    { label: 'New Patient', icon: 'bi-person-plus', color: '#198754', bg: '#19875415', path: '/patients' },
    { label: 'Schedule', icon: 'bi-calendar-plus', color: '#0d6efd', bg: '#0d6efd15', path: '/appointments' },
    { label: 'Patient Flow', icon: 'bi-kanban', color: '#0dcaf0', bg: '#0dcaf015', path: '/appointments/flow' },
    { label: 'Messages', icon: 'bi-chat-dots', color: '#fd7e14', bg: '#fd7e1415', path: '/messages' },
    { label: 'Reports', icon: 'bi-graph-up', color: '#6f42c1', bg: '#6f42c115', path: '/reports' },
    { label: 'Drug Info', icon: 'bi-capsule', color: '#dc3545', bg: '#dc354515', path: '/drug-info' },
    { label: 'Providers', icon: 'bi-people', color: '#0d6efd', bg: '#0d6efd15', path: '/providers' },
    { label: 'Billing', icon: 'bi-cash-stack', color: '#C8102E', bg: '#C8102E15', path: '/billing' },
  ];

  return (
    <div>
      <div className="rounded-4 p-4 mb-4 text-white" style={{background:'linear-gradient(135deg, #0d6efd 0%, #6610f2 40%, #C8102E 100%)'}}>
        <div className="d-flex justify-content-between align-items-start">
          <div>
            <h2 className="mb-1 fw-bold"><i className="bi bi-speedometer2 me-2"></i>Clinic Overview</h2>
            <p className="mb-0 text-white text-opacity-75 small">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="text-end">
            <div className="text-white text-opacity-75 small">Welcome back</div>
            <div className="fw-bold">{user?.displayName || 'Admin'}</div>
          </div>
        </div>
      </div>

      {/* Main Stats */}
      <div className="row g-3 mb-4">
        {[
          {v:totalPatients,l:'Total Patients',c:'#0d6efd',i:'bi-people',path:'/patients',sub:patientStats?.bySex?.filter((s:any)=>s.sex).map((s:any)=>`${s.sex}:${s.count}`).join(' · ')},
          {v:appointments.length,l:"Today's Appts",c:'#198754',i:'bi-calendar-check',path:'/appointments',sub:`${checkedIn} checked in`},
          {v:newMsgs,l:'New Messages',c:'#fd7e14',i:'bi-envelope-exclamation',path:'/messages',sub:`${messages.length} total`},
          {v:pendingPatients.length,l:'Pending Approval',c:'#dc3545',i:'bi-hourglass-split',path:'/registrar-dashboard',sub:'Registrar queue'},
          {v:totalEncounters,l:'Visits',c:'#6f42c1',i:'bi-clipboard-pulse',path:'/reports',sub:'Total recorded'},
          {v:8,l:'Quick Actions',c:'#0dcaf0',i:'bi-lightning-charge',path:'',sub:'Available'},
        ].map((s,i)=>(
          <div className="col-md-2 col-sm-4" key={i}>
            <div className="card border-0 shadow-sm h-100" style={{borderRadius:'16px',cursor:s.path?'pointer':'default'}}
              onClick={()=>s.path&&navigate(s.path)}>
              <div className="card-body text-center py-3">
                <div className="rounded-circle d-inline-flex align-items-center justify-content-center mb-2"
                  style={{width:'48px',height:'48px',backgroundColor:`${s.c}15`}}>
                  <i className={`bi ${s.i} fs-5`} style={{color:s.c}}></i>
                </div>
                <div className="fs-4 fw-bold" style={{color:s.c}}>{s.v}</div>
                <small className="text-muted d-block">{s.l}</small>
                {s.sub && <small className="text-muted" style={{fontSize:'0.7rem'}}>{s.sub}</small>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row g-3">
        {/* Today's Appointments */}
        <div className="col-lg-7">
          <div className="card border-0 shadow-sm" style={{borderRadius:'16px'}}>
            <div className="card-header bg-white d-flex justify-content-between py-3" style={{borderRadius:'16px 16px 0 0'}}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-calendar-event me-2 text-primary"></i>Today's Schedule</h6>
              <span className="badge bg-primary rounded-pill">{appointments.length}</span>
            </div>
            <div className="card-body p-0">
              {appointments.length>0?(
                <table className="table table-hover mb-0 small">
                  <thead className="table-light"><tr><th>Time</th><th>Patient</th><th>Title</th><th>Status</th></tr></thead>
                  <tbody>{appointments.map((a:any)=>(
                    <tr key={a.pc_eid}><td>{a.pc_startTime?.substring(0,5)||'—'}</td><td>#{a.pc_pid}</td><td>{a.pc_title||'—'}</td>
                      <td><span className={`badge rounded-pill ${a.pc_apptstatus==='Checked In'?'bg-info':a.pc_apptstatus==='Checkout'?'bg-success':'bg-secondary'}`}>{a.pc_apptstatus||'Scheduled'}</span></td></tr>
                  ))}</tbody>
                </table>
              ):<div className="text-center text-muted py-4"><i className="bi bi-calendar-x fs-3 d-block mb-2 opacity-50"></i>No appointments today</div>}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="col-lg-5">
          {/* Inventory Summary */}
          <div className="card border-0 shadow-sm mb-3" style={{borderRadius:'16px'}}>
            <div className="card-header bg-white d-flex justify-content-between align-items-center py-3" style={{borderRadius:'16px 16px 0 0'}}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-boxes me-2 text-primary"></i>Inventory</h6>
              <button className="btn btn-sm btn-outline-primary rounded-pill" onClick={()=>navigate('/inventory')}>View Inventory</button>
            </div>
            <div className="card-body py-2">
              <div className="d-flex justify-content-between py-2 border-bottom small">
                <span className="text-muted"><i className="bi bi-exclamation-triangle text-warning me-1"></i>Low Stock</span>
                <strong>{inventorySummary?.summary?.lowStock ?? 0}</strong>
              </div>
              <div className="d-flex justify-content-between py-2 border-bottom small">
                <span className="text-muted"><i className="bi bi-x-circle text-danger me-1"></i>Out of Stock</span>
                <strong>{inventorySummary?.summary?.outOfStock ?? 0}</strong>
              </div>
              <div className="d-flex justify-content-between py-2 small">
                <span className="text-muted"><i className="bi bi-hourglass-split text-info me-1"></i>Expiring Soon</span>
                <strong>{inventorySummary?.summary?.expiringSoon ?? 0}</strong>
              </div>
            </div>
          </div>

          {/* Pending Approvals */}
          <div className="card border-0 shadow-sm mb-3" style={{borderRadius:'16px'}}>
            <div className="card-header bg-white d-flex justify-content-between py-3" style={{borderRadius:'16px 16px 0 0'}}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-hourglass-split me-2 text-danger"></i>Pending Approvals</h6>
              <span className="badge bg-danger rounded-pill">{pendingPatients.length}</span>
            </div>
            <div className="card-body p-0">
              {pendingPatients.length>0?(
                pendingPatients.slice(0,4).map((p:any)=>(
                  <div key={p.id} className="d-flex align-items-center gap-2 px-3 py-2 border-bottom" style={{cursor:'pointer'}} onClick={()=>{ const cid = chartPatientId(p.id, p.pid); if (cid) navigate(`/patients/${cid}`); }}>
                    <div className="rounded-circle bg-danger bg-opacity-10 d-flex align-items-center justify-content-center" style={{width:'32px',height:'32px'}}>
                      <small className="fw-bold text-danger">{p.fname?.[0]}{p.lname?.[0]}</small>
                    </div>
                    <div className="flex-grow-1"><small className="fw-semibold">{formatPatientNameLastFirst(p)}</small><br/><small className="text-muted">{p.created_by||'—'} · {p.vitals_count||0} vitals</small></div>
                    <i className="bi bi-chevron-right text-muted small"></i>
                  </div>
                ))
              ):<div className="text-center text-muted py-3 small">No pending approvals</div>}
            </div>
          </div>

          {/* Recent Messages */}
          <div className="card border-0 shadow-sm" style={{borderRadius:'16px'}}>
            <div className="card-header bg-white d-flex justify-content-between py-3" style={{borderRadius:'16px 16px 0 0'}}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-chat-dots me-2 text-warning"></i>Recent Messages</h6>
            </div>
            <div className="card-body p-0">
              {messages.slice(0,5).map((m:any)=>(
                <div key={m.id} className="px-3 py-2 border-bottom small" style={{borderLeft:m.message_status==='New'?'4px solid #0d6efd':'4px solid transparent'}}>
                  <div className="fw-semibold">{m.title}</div>
                  <div className="text-muted text-truncate">{m.body}</div>
                </div>
              ))}
              {!messages.length&&<div className="text-center text-muted py-3 small">No messages</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions Grid */}
      <h6 className="fw-bold mt-4 mb-3"><i className="bi bi-lightning-charge me-2 text-info"></i>Quick Actions</h6>
      <div className="row g-2 mb-3">
        {quickActions.map(a=>(
          <div className="col-md-3 col-sm-4 col-6" key={a.label}>
            <button className="btn btn-light w-100 text-start d-flex align-items-center gap-2 py-2 shadow-sm"
              style={{borderRadius:'12px'}} onClick={()=>navigate(a.path)}>
              <div className="rounded-circle d-flex align-items-center justify-content-center" style={{width:'36px',height:'36px',backgroundColor:a.bg}}>
                <i className={`bi ${a.icon}`} style={{color:a.color}}></i>
              </div>
              <small className="fw-semibold">{a.label}</small>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
