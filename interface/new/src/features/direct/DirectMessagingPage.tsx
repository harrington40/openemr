import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';

export default function DirectMessagingPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ to_address: '', subject: '', body: '', pid: '', attachment_name: '' });

  const { data: messages = [] } = useQuery({
    queryKey: ['direct-messages'],
    queryFn: async () => { const r = await nestClient.get('/messages'); return r.data; },
  });

  const sendMessage = useMutation({
    mutationFn: (d: any) => nestClient.post('/messages', {
      title: `DIRECT: ${d.subject}`,
      body: `To: ${d.to_address}\nAttachment: ${d.attachment_name || 'None'}\nPatient: #${d.pid}\n\n${d.body}`,
      pid: d.pid || 0,
      type: 'direct',
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['direct-messages'] }); setForm({ to_address: '', subject: '', body: '', pid: '', attachment_name: '' }); },
  });

  const directMessages = messages.filter((m: any) => m.title?.startsWith('DIRECT:'));
  const sentCount = directMessages.length;

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
        .glass-page .list-group-item {
          background: transparent !important;
        }
      `}</style>
      <div className="rounded-4 p-4 mb-4 text-white position-relative" style={{background:'linear-gradient(135deg, #0d6efd 0%, #6610f2 40%, #0dcaf0 100%)', zIndex: 1}}>
        <div className="d-flex justify-content-between align-items-start">
          <div>
            <h2 className="mb-1 fw-bold"><i className="bi bi-envelope-arrow-up me-2"></i>Direct Messaging</h2>
            <p className="mb-0 text-white text-opacity-75 small">
              HISP-ready · Secure provider-to-provider · {sentCount} messages sent
            </p>
          </div>
          <span className="badge bg-light text-dark">Direct Secure Messaging</span>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-5">
          <div className="card border-0 shadow-sm" style={{borderRadius:'16px'}}>
            <div className="card-header bg-white py-3" style={{borderRadius:'16px 16px 0 0'}}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-pencil-square me-2 text-primary"></i>Compose Direct Message</h6>
            </div>
            <div className="card-body">
              <div className="mb-3"><label className="form-label small fw-semibold">To (Direct Address)</label>
                <input className="form-control form-control-sm rounded-pill" placeholder="provider@direct.example.com" value={form.to_address} onChange={e=>setForm({...form,to_address:e.target.value})} />
              </div>
              <div className="mb-3"><label className="form-label small fw-semibold">Subject</label>
                <input className="form-control form-control-sm rounded-pill" placeholder="Patient referral" value={form.subject} onChange={e=>setForm({...form,subject:e.target.value})} />
              </div>
              <div className="row g-2 mb-3">
                <div className="col-6"><label className="form-label small fw-semibold">Patient ID</label>
                  <input className="form-control form-control-sm rounded-pill" placeholder="e.g. 1" value={form.pid} onChange={e=>setForm({...form,pid:e.target.value})} /></div>
                <div className="col-6"><label className="form-label small fw-semibold">Attachment</label>
                  <input className="form-control form-control-sm rounded-pill" placeholder="CCDA.xml" value={form.attachment_name} onChange={e=>setForm({...form,attachment_name:e.target.value})} /></div>
              </div>
              <div className="mb-3"><label className="form-label small fw-semibold">Message Body</label>
                <textarea className="form-control form-control-sm" rows={5} placeholder="Type your message..." value={form.body} onChange={e=>setForm({...form,body:e.target.value})} style={{borderRadius:'12px'}} />
              </div>
              <button className="btn rounded-pill w-100 text-white" style={{background:'linear-gradient(135deg,#0d6efd,#6610f2)'}}
                onClick={()=>sendMessage.mutate(form)} disabled={sendMessage.isPending||!form.to_address}>
                {sendMessage.isPending?<><span className="spinner-border spinner-border-sm me-1"></span>Sending...</>:<><i className="bi bi-send me-1"></i>Send via Direct</>}
              </button>
            </div>
          </div>
        </div>

        <div className="col-lg-7">
          <div className="card border-0 shadow-sm mb-3" style={{borderRadius:'16px'}}>
            <div className="card-header bg-white d-flex justify-content-between py-3" style={{borderRadius:'16px 16px 0 0'}}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-inbox me-2 text-primary"></i>Sent / Received</h6>
              <span className="badge bg-primary rounded-pill">{sentCount}</span>
            </div>
            <div className="card-body p-0">
              <table className="table table-hover mb-0 small">
                <thead className="table-light"><tr><th>Date</th><th>To/From</th><th>Subject</th><th>Patient</th></tr></thead>
                <tbody>
                  {directMessages.map((m:any)=>(
                    <tr key={m.id}><td>{m.date}</td><td>{m.body?.split('\n')[0]?.replace('To: ','')}</td><td>{m.title?.replace('DIRECT: ','')}</td><td>#{m.pid}</td></tr>
                  ))}
                  {!sentCount&&<tr><td colSpan={4} className="text-center text-muted py-4">No Direct messages sent yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="alert d-flex align-items-center small" style={{backgroundColor:'#0d6efd10',borderRadius:'12px'}}>
            <i className="bi bi-info-circle me-2" style={{color:'#0d6efd'}}></i>
            <div>Direct Messaging requires a <strong>HISP</strong> (Health Information Service Provider) account for production use. Messages are routed through the internal event bus system.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
