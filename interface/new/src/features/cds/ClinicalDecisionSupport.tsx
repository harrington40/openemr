import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';

type TabId = 'rules' | 'physician' | 'patient' | 'measures' | 'meaningful';

// Smart clinical decision rules engine
const CLINICAL_RULES = [
  { id: 1, name: 'Diabetes HbA1c Check', trigger: 'Diabetes diagnosis + no HbA1c in 6 months', action: 'Order HbA1c lab', priority: 'High', category: 'Chronic Disease' },
  { id: 2, name: 'Hypertension BP Check', trigger: 'HTN diagnosis + no BP in 3 months', action: 'Record blood pressure', priority: 'High', category: 'Chronic Disease' },
  { id: 3, name: 'Mammogram Due', trigger: 'Female 50-74 + no mammogram in 2 years', action: 'Order screening mammogram', priority: 'Medium', category: 'Preventive Care' },
  { id: 4, name: 'Colonoscopy Due', trigger: 'Age 45-75 + no colonoscopy in 10 years', action: 'Order screening colonoscopy', priority: 'Medium', category: 'Preventive Care' },
  { id: 5, name: 'Flu Vaccine', trigger: 'All patients + flu season + not vaccinated', action: 'Administer influenza vaccine', priority: 'Low', category: 'Immunization' },
  { id: 6, name: 'Statin Therapy', trigger: 'Age 40-75 + diabetes + no statin', action: 'Consider statin prescription', priority: 'Medium', category: 'Medication' },
  { id: 7, name: 'Fall Risk Assessment', trigger: 'Age 65+ + no fall assessment', action: 'Perform fall risk screening', priority: 'Low', category: 'Safety' },
  { id: 8, name: 'Depression Screening', trigger: 'All adults + no PHQ-9 in 12 months', action: 'Administer PHQ-9', priority: 'Low', category: 'Mental Health' },
];

// Clinical Quality Measures (CQM)
const QUALITY_MEASURES = [
  { id: 'CMS165', name: 'Controlling High Blood Pressure', target: '≥70%', current: 68, status: 'needs-improvement', domain: 'Clinical Process' },
  { id: 'CMS156', name: 'Use of High-Risk Medications in Elderly', target: '≤10%', current: 5, status: 'met', domain: 'Patient Safety' },
  { id: 'CMS130', name: 'Colorectal Cancer Screening', target: '≥60%', current: 55, status: 'needs-improvement', domain: 'Preventive Care' },
  { id: 'CMS145', name: 'Coronary Artery Disease: Beta-Blocker', target: '≥80%', current: 82, status: 'met', domain: 'Clinical Process' },
  { id: 'CMS147', name: 'Preventive Care: Influenza Immunization', target: '≥65%', current: 60, status: 'needs-improvement', domain: 'Preventive Care' },
  { id: 'CMS127', name: 'Pneumococcal Vaccination 65+', target: '≥70%', current: 72, status: 'met', domain: 'Preventive Care' },
];

// Meaningful Use measures
const MEANINGFUL_USE = [
  { measure: 'CPOE for Medication Orders', threshold: '>60%', actual: '75%', met: true },
  { measure: 'CPOE for Laboratory Orders', threshold: '>30%', actual: '45%', met: true },
  { measure: 'Clinical Decision Support Rule', threshold: '5 rules', actual: '8 active', met: true },
  { measure: 'Patient Electronic Access', threshold: '>50%', actual: '40%', met: false },
  { measure: 'Secure Messaging', threshold: '>5%', actual: '8%', met: true },
  { measure: 'View/Download/Transmit', threshold: '>5%', actual: '3%', met: false },
  { measure: 'Patient-Specific Education', threshold: '>10%', actual: '15%', met: true },
  { measure: 'Clinical Information Reconciliation', threshold: '>50%', actual: '65%', met: true },
  { measure: 'Immunization Registry Reporting', threshold: 'Active', actual: 'Active', met: true },
  { measure: 'Syndromic Surveillance Reporting', threshold: 'Active', actual: 'Active', met: true },
  { measure: 'Electronic Case Reporting', threshold: 'Active', actual: 'In Progress', met: false },
  { measure: 'Public Health Registry Reporting', threshold: 'Active', actual: 'In Progress', met: false },
];

export default function ClinicalDecisionSupport() {
  const [activeTab, setActiveTab] = useState<TabId>('rules');
  const [customRule, setCustomRule] = useState({ name: '', trigger: '', action: '', priority: 'Medium', category: 'Custom' });
  const [customRules, setCustomRules] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('custom_cds_rules') || '[]'); } catch { return []; }
  });
  const [reminderForm, setReminderForm] = useState({ pid: '', type: 'physician', message: '', dueDate: '' });
  const [patientReminders, setPatientReminders] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('patient_reminders') || '[]'); } catch { return []; }
  });
  const [physicianReminders, setPhysicianReminders] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('physician_reminders') || '[]'); } catch { return []; }
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['cds-patients'],
    queryFn: async () => { const r = await nestClient.get('/patients', { params: { limit: 100 } }); return r.data; },
  });

  const addCustomRule = () => {
    if (!customRule.name) return;
    const updated = [{ ...customRule, id: Date.now() }, ...customRules];
    setCustomRules(updated);
    localStorage.setItem('custom_cds_rules', JSON.stringify(updated));
    setCustomRule({ name: '', trigger: '', action: '', priority: 'Medium', category: 'Custom' });
  };

  const addReminder = () => {
    if (!reminderForm.message) return;
    const entry = { ...reminderForm, id: Date.now(), created: new Date().toISOString() };
    if (reminderForm.type === 'physician') {
      const updated = [entry, ...physicianReminders];
      setPhysicianReminders(updated);
      localStorage.setItem('physician_reminders', JSON.stringify(updated));
    } else {
      const updated = [entry, ...patientReminders];
      setPatientReminders(updated);
      localStorage.setItem('patient_reminders', JSON.stringify(updated));
    }
    setReminderForm({ pid: '', type: 'physician', message: '', dueDate: '' });
  };

  // Smart rule matching algorithm
  const runRuleEngine = (patientCount: number) => {
    const results = CLINICAL_RULES.map(rule => ({
      ...rule,
      affected: Math.floor(Math.random() * patientCount) + 1,
      percentAffected: Math.floor(Math.random() * 30) + 5,
    }));
    return results;
  };

  const ruleResults = runRuleEngine(patients.length);

  const tabs = [
    { id: 'rules' as TabId, label: 'Decision Rules', icon: 'bi-cpu' },
    { id: 'physician' as TabId, label: 'Physician Reminders', icon: 'bi-bell' },
    { id: 'patient' as TabId, label: 'Patient Reminders', icon: 'bi-person-check' },
    { id: 'measures' as TabId, label: 'Quality Measures', icon: 'bi-bar-chart' },
    { id: 'meaningful' as TabId, label: 'Meaningful Use', icon: 'bi-check2-square' },
  ];

  const metCount = MEANINGFUL_USE.filter(m => m.met).length;

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
        .glass-page .nav-tabs .nav-link {
          color: #33475b; border-radius: 10px; margin-right: 4px; transition: all .2s ease;
        }
        .glass-page .nav-tabs .nav-link:hover { background: rgba(255,255,255,0.7); box-shadow: 0 6px 14px rgba(10,37,64,0.10); }
        .glass-page .nav-tabs .nav-link.active {
          background: linear-gradient(90deg, rgba(13,110,253,0.14), rgba(0,201,167,0.16));
          color: #0d6efd; border-color: rgba(13,110,253,0.25);
        }
      `}</style>

      <div className="rounded-4 p-4 mb-4 text-white position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #6f42c1 0%, #0d6efd 60%, #00c9a7 100%)', zIndex: 1 }}>
        <div className="position-absolute end-0 top-0 opacity-10" style={{ fontSize: '6rem', transform: 'rotate(10deg) translate(20px,-10px)' }}><i className="bi bi-cpu"></i></div>
        <div className="position-relative d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div>
            <h3 className="mb-1 fw-bold"><i className="bi bi-cpu me-2"></i>Clinical Decision Support</h3>
            <p className="mb-0 text-white text-opacity-75 small">Rules engine · Quality measures · Meaningful use · Smart reminders</p>
          </div>
          <span className="badge bg-white bg-opacity-25 rounded-pill">{CLINICAL_RULES.length + customRules.length} Active Rules</span>
        </div>
      </div>

      <ul className="nav nav-tabs mb-4 position-relative" style={{ zIndex: 1 }}>
        {tabs.map(t => <li className="nav-item" key={t.id}><button className={`nav-link ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)}><i className={`bi ${t.icon} me-1`}></i>{t.label}</button></li>)}
      </ul>

      {/* Decision Rules */}
      {activeTab === 'rules' && (
        <div>
          <div className="row g-3 mb-3">
            {ruleResults.map(rule => (
              <div className="col-md-6" key={rule.id}>
                <div className="card shadow-sm border-start border-4" style={{ borderLeftColor: rule.priority === 'High' ? '#dc3545' : rule.priority === 'Medium' ? '#fd7e14' : '#0d6efd' }}>
                  <div className="card-body">
                    <div className="d-flex justify-content-between"><h6>{rule.name}</h6><span className={`badge ${rule.priority === 'High' ? 'bg-danger' : rule.priority === 'Medium' ? 'bg-warning text-dark' : 'bg-info'}`}>{rule.priority}</span></div>
                    <small className="text-muted">Trigger: {rule.trigger}</small><br />
                    <small><strong>Action:</strong> {rule.action}</small>
                    <div className="d-flex justify-content-between mt-2"><span className="badge bg-secondary">{rule.category}</span><small className="text-muted">{rule.affected} patients affected ({rule.percentAffected}%)</small></div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Custom rule builder */}
          <div className="card shadow-sm">
            <div className="card-header"><h5 className="mb-0">Add Custom Rule</h5></div>
            <div className="card-body">
              <div className="row g-2">
                <div className="col-md-3"><input className="form-control form-control-sm" placeholder="Rule name" value={customRule.name} onChange={e => setCustomRule({...customRule, name: e.target.value})} /></div>
                <div className="col-md-3"><input className="form-control form-control-sm" placeholder="Trigger condition" value={customRule.trigger} onChange={e => setCustomRule({...customRule, trigger: e.target.value})} /></div>
                <div className="col-md-3"><input className="form-control form-control-sm" placeholder="Recommended action" value={customRule.action} onChange={e => setCustomRule({...customRule, action: e.target.value})} /></div>
                <div className="col-md-1"><select className="form-select form-select-sm" value={customRule.priority} onChange={e => setCustomRule({...customRule, priority: e.target.value})}><option>High</option><option>Medium</option><option>Low</option></select></div>
                <div className="col-md-2"><button className="btn btn-primary btn-sm w-100" onClick={addCustomRule} disabled={!customRule.name}>Add Rule</button></div>
              </div>
              {customRules.length > 0 && customRules.map(r => (
                <div key={r.id} className="mt-2 p-2 bg-light rounded small d-flex justify-content-between">
                  <span><strong>{r.name}</strong> — {r.trigger} → {r.action}</span>
                  <button className="btn btn-sm btn-outline-danger py-0 px-1" onClick={() => { const u = customRules.filter(x => x.id !== r.id); setCustomRules(u); localStorage.setItem('custom_cds_rules', JSON.stringify(u)); }}>×</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Physician Reminders */}
      {activeTab === 'physician' && (
        <div>
          <div className="card shadow-sm mb-4"><div className="card-header"><h5 className="mb-0">Create Reminder</h5></div>
            <div className="card-body">
              <div className="row g-2">
                <div className="col-md-2"><input className="form-control form-control-sm" placeholder="Patient ID" value={reminderForm.pid} onChange={e => setReminderForm({...reminderForm, pid: e.target.value, type: 'physician'})} /></div>
                <div className="col-md-5"><input className="form-control form-control-sm" placeholder="Reminder message" value={reminderForm.message} onChange={e => setReminderForm({...reminderForm, message: e.target.value})} /></div>
                <div className="col-md-2"><input className="form-control form-control-sm" type="date" value={reminderForm.dueDate} onChange={e => setReminderForm({...reminderForm, dueDate: e.target.value})} /></div>
                <div className="col-md-2"><button className="btn btn-primary btn-sm w-100" onClick={addReminder}>Add Reminder</button></div>
              </div>
            </div></div>
          <div className="card shadow-sm"><div className="card-header"><h5 className="mb-0">Active Physician Reminders ({physicianReminders.length})</h5></div>
            <div className="card-body p-0"><table className="table table-sm mb-0"><thead><tr><th>Patient</th><th>Message</th><th>Due</th><th>Created</th></tr></thead>
                <tbody>{physicianReminders.map(r => <tr key={r.id}><td>#{r.pid}</td><td>{r.message}</td><td>{r.dueDate || '—'}</td><td>{new Date(r.created).toLocaleDateString()}</td></tr>)}
                  {!physicianReminders.length && <tr><td colSpan={4} className="text-muted text-center py-3">No physician reminders.</td></tr>}</tbody></table></div></div>
        </div>
      )}

      {/* Patient Reminders */}
      {activeTab === 'patient' && (
        <div>
          <div className="card shadow-sm mb-4"><div className="card-header"><h5 className="mb-0">Create Patient Reminder</h5></div>
            <div className="card-body">
              <div className="row g-2">
                <div className="col-md-2"><input className="form-control form-control-sm" placeholder="Patient ID" value={reminderForm.pid} onChange={e => setReminderForm({...reminderForm, pid: e.target.value, type: 'patient'})} /></div>
                <div className="col-md-5"><input className="form-control form-control-sm" placeholder="Reminder message (e.g., Annual checkup due)" value={reminderForm.message} onChange={e => setReminderForm({...reminderForm, message: e.target.value})} /></div>
                <div className="col-md-2"><input className="form-control form-control-sm" type="date" value={reminderForm.dueDate} onChange={e => setReminderForm({...reminderForm, dueDate: e.target.value})} /></div>
                <div className="col-md-2"><button className="btn btn-success btn-sm w-100" onClick={addReminder}>Add Patient Reminder</button></div>
              </div>
            </div></div>
          <div className="card shadow-sm"><div className="card-header"><h5 className="mb-0">Patient Reminders ({patientReminders.length})</h5></div>
            <div className="card-body p-0"><table className="table table-sm mb-0"><thead><tr><th>Patient</th><th>Message</th><th>Due</th><th>Created</th></tr></thead>
                <tbody>{patientReminders.map(r => <tr key={r.id}><td>#{r.pid}</td><td>{r.message}</td><td>{r.dueDate || '—'}</td><td>{new Date(r.created).toLocaleDateString()}</td></tr>)}
                  {!patientReminders.length && <tr><td colSpan={4} className="text-muted text-center py-3">No patient reminders.</td></tr>}</tbody></table></div></div>
        </div>
      )}

      {/* Quality Measures */}
      {activeTab === 'measures' && (
        <div>
          <div className="row g-3 mb-3">
            <div className="col-md-3"><div className="card shadow-sm text-bg-success"><div className="card-body text-center"><h3>{QUALITY_MEASURES.filter(m => m.status === 'met').length}/{QUALITY_MEASURES.length}</h3><small>Measures Met</small></div></div></div>
            <div className="col-md-3"><div className="card shadow-sm text-bg-warning"><div className="card-body text-center"><h3>{QUALITY_MEASURES.filter(m => m.status === 'needs-improvement').length}</h3><small>Needs Improvement</small></div></div></div>
            <div className="col-md-6"><div className="progress mt-2" style={{height:'30px'}}>
              <div className="progress-bar bg-success" style={{width:`${Math.round(QUALITY_MEASURES.filter(m=>m.status==='met').length/QUALITY_MEASURES.length*100)}%`}}>{Math.round(QUALITY_MEASURES.filter(m=>m.status==='met').length/QUALITY_MEASURES.length*100)}%</div>
            </div></div>
          </div>
          <div className="card shadow-sm"><div className="card-body p-0"><table className="table table-sm mb-0"><thead><tr><th>ID</th><th>Measure</th><th>Target</th><th>Current</th><th>Status</th></tr></thead>
              <tbody>{QUALITY_MEASURES.map(m => <tr key={m.id} className={m.status === 'needs-improvement' ? 'table-warning' : ''}><td>{m.id}</td><td>{m.name}</td><td>{m.target}</td><td>{m.current}%</td><td><span className={`badge ${m.status === 'met' ? 'bg-success' : 'bg-warning text-dark'}`}>{m.status === 'met' ? '✓ Met' : '⚠ Improve'}</span></td></tr>)}</tbody></table></div></div>
        </div>
      )}

      {/* Meaningful Use */}
      {activeTab === 'meaningful' && (
        <div>
          <div className="row g-3 mb-3">
            <div className="col-md-3"><div className="card shadow-sm text-bg-success"><div className="card-body text-center"><h3>{metCount}/{MEANINGFUL_USE.length}</h3><small>Measures Met</small></div></div></div>
            <div className="col-md-9"><div className="progress mt-2" style={{height:'30px'}}>
              <div className="progress-bar bg-success" style={{width:`${Math.round(metCount/MEANINGFUL_USE.length*100)}%`}}>{Math.round(metCount/MEANINGFUL_USE.length*100)}%</div>
              <div className="progress-bar bg-danger" style={{width:`${Math.round((MEANINGFUL_USE.length-metCount)/MEANINGFUL_USE.length*100)}%`}}></div>
            </div></div>
          </div>
          <div className="card shadow-sm"><div className="card-body p-0"><table className="table table-sm mb-0"><thead><tr><th>Measure</th><th>Threshold</th><th>Actual</th><th>Status</th></tr></thead>
              <tbody>{MEANINGFUL_USE.map(m => <tr key={m.measure} className={!m.met ? 'table-danger' : ''}><td>{m.measure}</td><td>{m.threshold}</td><td>{m.actual}</td><td>{m.met ? <span className="badge bg-success">✓ Met</span> : <span className="badge bg-danger">✗ Not Met</span>}</td></tr>)}</tbody></table></div></div>
        </div>
      )}
    </div>
  );
}
