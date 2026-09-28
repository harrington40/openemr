import { useState } from 'react';

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('form_templates') || '[]'); } catch { return []; }
  });
  const [form, setForm] = useState({ name: '', category: 'soap', subjective: '', objective: '', assessment: '', plan: '' });

  const saveTemplate = () => {
    if (!form.name) return;
    const updated = [{ ...form, id: Date.now() }, ...templates];
    setTemplates(updated);
    localStorage.setItem('form_templates', JSON.stringify(updated));
    setForm({ name: '', category: 'soap', subjective: '', objective: '', assessment: '', plan: '' });
  };

  const deleteTemplate = (id: number) => {
    const updated = templates.filter(t => t.id !== id);
    setTemplates(updated);
    localStorage.setItem('form_templates', JSON.stringify(updated));
  };

  const applyTemplate = (t: any) => setForm({ ...form, ...t, name: '' });

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
        <div className="position-absolute end-0 top-0 opacity-10" style={{ fontSize: '6rem', transform: 'rotate(10deg) translate(20px,-10px)' }}><i className="bi bi-file-earmark-text"></i></div>
        <div className="position-relative">
          <h3 className="mb-1 fw-bold"><i className="bi bi-file-earmark-text me-2"></i>Form Templates</h3>
          <p className="mb-0 text-white text-opacity-75 small">Create and manage SOAP, ROS, and exam templates.</p>
        </div>
      </div>
      <div className="row g-3 position-relative" style={{ zIndex: 1 }}>
        <div className="col-md-5">
          <div className="card shadow-sm">
            <div className="card-header"><h5 className="mb-0">Create Template</h5></div>
            <div className="card-body">
              <div className="mb-2"><label className="form-label small">Template Name</label><input className="form-control form-control-sm" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g., Annual Physical SOAP" /></div>
              <div className="mb-2"><label className="form-label small">Category</label><select className="form-select form-select-sm" value={form.category} onChange={e => setForm({...form, category: e.target.value})}><option value="soap">SOAP Note</option><option value="ros">Review of Systems</option><option value="exam">Physical Exam</option></select></div>
              <div className="mb-2"><label className="form-label small">Subjective</label><textarea className="form-control form-control-sm" rows={2} value={form.subjective} onChange={e => setForm({...form, subjective: e.target.value})} /></div>
              <div className="mb-2"><label className="form-label small">Objective</label><textarea className="form-control form-control-sm" rows={2} value={form.objective} onChange={e => setForm({...form, objective: e.target.value})} /></div>
              <div className="mb-2"><label className="form-label small">Assessment</label><textarea className="form-control form-control-sm" rows={2} value={form.assessment} onChange={e => setForm({...form, assessment: e.target.value})} /></div>
              <button className="btn btn-primary btn-sm" onClick={saveTemplate} disabled={!form.name}>Save Template</button>
            </div>
          </div>
        </div>
        <div className="col-md-7">
          <div className="card shadow-sm">
            <div className="card-header"><h5 className="mb-0">Saved Templates ({templates.length})</h5></div>
            <div className="card-body p-0">
              {templates.map((t: any) => (
                <div key={t.id} className="border-bottom p-3">
                  <div className="d-flex justify-content-between">
                    <strong>{t.name}</strong> <span className="badge bg-secondary">{t.category}</span>
                  </div>
                  {t.subjective && <div className="small text-muted mt-1">S: {t.subjective.substring(0, 100)}</div>}
                  <div className="d-flex gap-2 mt-1">
                    <button className="btn btn-outline-primary btn-sm" onClick={() => applyTemplate(t)}>Apply</button>
                    <button className="btn btn-outline-danger btn-sm" onClick={() => deleteTemplate(t.id)}>Delete</button>
                  </div>
                </div>
              ))}
              {!templates.length && <p className="text-muted text-center py-3 mb-0">No templates saved.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
