import { useState } from 'react';

export default function DisclosuresPage() {
  const [disclosures, setDisclosures] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('disclosures') || '[]'); } catch { return []; }
  });
  const [form, setForm] = useState({ patientId: '', patientName: '', recipient: '', purpose: '', date: '', notes: '' });

  const addDisclosure = () => {
    if (!form.patientId) return;
    const entry = { ...form, id: Date.now(), created: new Date().toISOString() };
    const updated = [entry, ...disclosures];
    setDisclosures(updated);
    localStorage.setItem('disclosures', JSON.stringify(updated));
    setForm({ patientId: '', patientName: '', recipient: '', purpose: '', date: '', notes: '' });
  };

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

      <div className="rounded-4 p-4 mb-4 text-white position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #6f42c1 0%, #0d6efd 60%, #00c9a7 100%)', zIndex: 1 }}>
        <div className="position-absolute end-0 top-0 opacity-10" style={{ fontSize: '6rem', transform: 'rotate(10deg) translate(20px,-10px)' }}><i className="bi bi-shield-lock"></i></div>
        <div className="position-relative">
          <h3 className="mb-1 fw-bold"><i className="bi bi-shield-lock me-2"></i>PHI Disclosures</h3>
          <p className="mb-0 text-white text-opacity-75 small">Track protected health information disclosures.</p>
        </div>
      </div>
      <div className="card shadow-sm mb-4">
        <div className="card-header"><h5 className="mb-0">Record Disclosure</h5></div>
        <div className="card-body">
          <div className="row g-2">
            <div className="col-md-2"><input className="form-control form-control-sm" placeholder="Patient ID" value={form.patientId} onChange={e => setForm({...form, patientId: e.target.value})} /></div>
            <div className="col-md-2"><input className="form-control form-control-sm" placeholder="Patient Name" value={form.patientName} onChange={e => setForm({...form, patientName: e.target.value})} /></div>
            <div className="col-md-2"><input className="form-control form-control-sm" placeholder="Recipient" value={form.recipient} onChange={e => setForm({...form, recipient: e.target.value})} /></div>
            <div className="col-md-2"><input className="form-control form-control-sm" placeholder="Purpose" value={form.purpose} onChange={e => setForm({...form, purpose: e.target.value})} /></div>
            <div className="col-md-2"><input className="form-control form-control-sm" type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} /></div>
            <div className="col-md-2"><button className="btn btn-primary btn-sm w-100" onClick={addDisclosure} disabled={!form.patientId}>Record</button></div>
          </div>
        </div>
      </div>
      <div className="card shadow-sm">
        <div className="card-header"><h5 className="mb-0">Disclosure Log ({disclosures.length})</h5></div>
        <div className="card-body p-0">
          <table className="table table-sm table-hover mb-0"><thead><tr><th>Date</th><th>Patient</th><th>Recipient</th><th>Purpose</th><th>Disclosure Date</th></tr></thead>
            <tbody>{disclosures.map((d: any) => <tr key={d.id}><td>{new Date(d.created).toLocaleDateString()}</td><td>#{d.patientId} {d.patientName}</td><td>{d.recipient}</td><td>{d.purpose}</td><td>{d.date}</td></tr>)}
              {!disclosures.length && <tr><td colSpan={5} className="text-muted text-center py-3">No disclosures recorded.</td></tr>}</tbody></table>
        </div>
      </div>
    </div>
  );
}
