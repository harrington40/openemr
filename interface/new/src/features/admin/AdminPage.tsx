import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';
import PhoneInput from '../../components/shared/PhoneInput';

type TabId = 'users' | 'facilities' | 'lists' | 'notifications' | 'chart-tracking' | 'settings' | 'pending' | 'menu-access' | 'lab-codes';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabId>('users');

  return (
    <div className="glass-page position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #dbeafe 0%, #f5faff 45%, #d1fae5 100%)', borderRadius: '20px', minHeight: '100vh', padding: '16px' }}>
      <div className="position-absolute rounded-circle" style={{ width: '320px', height: '320px', top: '-90px', right: '-70px', background: 'radial-gradient(circle, rgba(13,110,253,0.30), transparent 70%)', filter: 'blur(20px)', zIndex: 0 }}></div>
      <div className="position-absolute rounded-circle" style={{ width: '380px', height: '380px', bottom: '8%', left: '-120px', background: 'radial-gradient(circle, rgba(0,201,167,0.30), transparent 70%)', filter: 'blur(20px)', zIndex: 0 }}></div>
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
          color: #33475b;
          border: 1px solid transparent;
          border-radius: 10px;
          margin-right: 4px;
          transition: all .2s ease;
        }
        .glass-page .nav-tabs .nav-link:hover {
          background: rgba(255,255,255,0.7);
          box-shadow: 0 6px 14px rgba(10,37,64,0.10);
        }
        .glass-page .nav-tabs .nav-link.active {
          background: linear-gradient(90deg, rgba(13,110,253,0.14), rgba(0,201,167,0.16));
          color: #0d6efd;
          border-color: rgba(13,110,253,0.25);
        }
      `}</style>

      <div className="rounded-4 p-4 mb-4 text-white position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0d6efd 0%, #198754 60%, #0dcaf0 100%)', zIndex: 1 }}>
        <div className="position-absolute end-0 top-0 opacity-10" style={{ fontSize: '7rem', transform: 'rotate(10deg) translate(20px,-15px)' }}><i className="bi bi-gear-wide-connected"></i></div>
        <div className="position-relative d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div>
            <h3 className="mb-1 fw-bold"><i className="bi bi-gear-wide-connected me-2"></i>Administration</h3>
            <p className="mb-0 text-white text-opacity-75 small">Manage users, facilities, lookup lists, notifications, and system settings.</p>
          </div>
        </div>
      </div>

      <ul className="nav nav-tabs mb-4 position-relative" style={{ zIndex: 1 }}>
        {[
          { id: 'pending' as TabId, label: 'Pending Registrations', icon: 'bi-hourglass-split' },
          { id: 'users' as TabId, label: 'Users', icon: 'bi-people' },
          { id: 'facilities' as TabId, label: 'Facilities', icon: 'bi-building' },
          { id: 'lists' as TabId, label: 'Lookup Lists', icon: 'bi-list-ul' },
          { id: 'notifications' as TabId, label: 'Notifications', icon: 'bi-bell' },
          { id: 'chart-tracking' as TabId, label: 'Chart Tracking', icon: 'bi-folder2' },
          { id: 'settings' as TabId, label: 'Settings', icon: 'bi-sliders' },
          { id: 'lab-codes' as TabId, label: 'Lab Delete Codes', icon: 'bi-shield-lock' },
          { id: 'menu-access' as TabId, label: 'Menu Access', icon: 'bi-menu-button-wide' },
        ].map(tab => (
          <li className="nav-item" key={tab.id}>
            <button className={`nav-link ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>
              <i className={`bi ${tab.icon} me-1`}></i>{tab.label}
            </button>
          </li>
        ))}
      </ul>

      {activeTab === 'pending' && <PendingRegistrationsTab />}
      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'facilities' && <FacilitiesTab />}
      {activeTab === 'lists' && <ListsTab />}
      {activeTab === 'notifications' && <NotificationSettingsTab />}
      {activeTab === 'chart-tracking' && <ChartTrackingTab />}
      {activeTab === 'settings' && <SettingsTab />}
      {activeTab === 'lab-codes' && <LabDeleteCodesTab />}
      {activeTab === 'menu-access' && <MenuAccessTab />}
    </div>
  );
}

function UsersTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ username: '', fname: '', lname: '' });

  const { data: users = [] } = useQuery({ queryKey: ['admin-users'], queryFn: async () => { const r = await nestClient.get('/admin/users'); return r.data; } });

  const createUser = useMutation({
    mutationFn: (d: any) => nestClient.post('/admin/users', d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-users'] }); setForm({ username: '', fname: '', lname: '' }); },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: number; active: number }) => nestClient.put(`/admin/users/${id}`, { active: active ? 0 : 1 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const toggleChartView = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => nestClient.put(`/admin/users/${id}/chart-view-privilege`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const toggleEditProviders = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => nestClient.put(`/admin/users/${id}/provider-edit-privilege`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const toggleEditCharges = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => nestClient.put(`/admin/users/${id}/charge-edit-privilege`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const roleLabel = (role: string) => {
    switch (role) {
      case 'admin': return { label: 'Admin', color: 'danger' };
      case 'front_office': return { label: 'Front Desk', color: 'info' };
      case 'standard': return { label: 'Physician', color: 'primary' };
      case 'nurse': return { label: 'Nurse', color: 'success' };
      case 'billing': return { label: 'Billing', color: 'warning' };
      case 'inventory_manager': return { label: 'Inventory Manager', color: 'success' };
      default: return { label: role || '—', color: 'secondary' };
    }
  };

  return (
    <div>
      <div className="card mb-4">
        <div className="card-header"><h5 className="mb-0">Add User</h5></div>
        <div className="card-body">
          <div className="row g-2">
            <div className="col-md-3"><input className="form-control form-control-sm" placeholder="Username" value={form.username} onChange={e => setForm({...form, username: e.target.value})} /></div>
            <div className="col-md-3"><input className="form-control form-control-sm" placeholder="First Name" value={form.fname} onChange={e => setForm({...form, fname: e.target.value})} /></div>
            <div className="col-md-3"><input className="form-control form-control-sm" placeholder="Last Name" value={form.lname} onChange={e => setForm({...form, lname: e.target.value})} /></div>
            <div className="col-md-3"><button className="btn btn-primary btn-sm w-100" onClick={() => createUser.mutate(form)} disabled={createUser.isPending || !form.username}>Create User</button></div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-header bg-white d-flex justify-content-between align-items-center">
          <h6 className="mb-0"><i className="bi bi-people me-2"></i>All Users ({users.length})</h6>
          <small className="text-muted">Toggle privileges below — changes apply immediately</small>
        </div>
        <div className="card-body p-0">
          <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
            <table className="table table-sm table-hover mb-0">
              <thead className="table-light sticky-top">
                <tr>
                  <th>ID</th><th>Username</th><th>Name</th><th>Role</th><th>Active</th>
                  <th className="text-center">Chart View</th>
                  <th className="text-center">Edit Providers</th>
                  <th className="text-center">Edit Charges</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u: any) => {
                  const rl = roleLabel(u.main_menu_role);
                  return (
                    <tr key={u.id}>
                      <td className="text-muted small">{u.id}</td>
                      <td><strong>{u.username}</strong></td>
                      <td>{u.fname} {u.lname}</td>
                      <td><span className={`badge bg-${rl.color}`}>{rl.label}</span></td>
                      <td>
                        <span className={`badge ${u.active ? 'bg-success' : 'bg-secondary'}`}>
                          {u.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="text-center">
                        <div className="form-check form-switch d-inline-block mb-0">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            role="switch"
                            checked={u.can_view_charts === 1}
                            onChange={() => toggleChartView.mutate({ id: u.id, enabled: u.can_view_charts !== 1 })}
                            disabled={toggleChartView.isPending}
                          />
                        </div>
                      </td>
                      <td className="text-center">
                        <div className="form-check form-switch d-inline-block mb-0">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            role="switch"
                            checked={u.can_edit_providers === 1}
                            onChange={() => toggleEditProviders.mutate({ id: u.id, enabled: u.can_edit_providers !== 1 })}
                            disabled={toggleEditProviders.isPending}
                          />
                        </div>
                      </td>
                      <td className="text-center">
                        <div className="form-check form-switch d-inline-block mb-0">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            role="switch"
                            checked={u.can_edit_charges === 1}
                            onChange={() => toggleEditCharges.mutate({ id: u.id, enabled: u.can_edit_charges !== 1 })}
                            disabled={toggleEditCharges.isPending}
                            title="Allow this user to create/update charges"
                          />
                        </div>
                      </td>
                      <td>
                        <button
                          className="btn btn-outline-secondary btn-sm"
                          onClick={() => toggleActive.mutate({ id: u.id, active: u.active })}
                        >
                          {u.active ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {users.length === 0 && (
                  <tr><td colSpan={9} className="text-center text-muted py-3">No users found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function FacilitiesTab() {
  const { data: facilities = [] } = useQuery({ queryKey: ['facilities'], queryFn: async () => { const r = await nestClient.get('/facilities'); return r.data; } });

  return (
    <div className="card">
      <div className="card-header"><h5 className="mb-0">Facilities ({facilities.length})</h5></div>
      <div className="card-body p-0">
        <table className="table table-sm table-hover mb-0">
          <thead><tr><th>ID</th><th>Name</th><th>Phone</th><th>Address</th></tr></thead>
          <tbody>
            {facilities.map((f: any) => (
              <tr key={f.id}><td>{f.id}</td><td><strong>{f.name}</strong></td><td>{f.phone || '—'}</td>
                <td>{[f.street, f.city].filter(Boolean).join(', ') || '—'}</td></tr>
            ))}
            {!facilities.length && <tr><td colSpan={4} className="text-muted text-center">No facilities found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ListsTab() {
  const { data: lists = [] } = useQuery({
    queryKey: ['admin-lists'],
    queryFn: async () => { const r = await nestClient.get('/admin/lists'); return r.data; },
  });

  return (
    <div className="card">
      <div className="card-header"><h5 className="mb-0">Lookup Lists</h5></div>
      <div className="card-body p-0">
        <table className="table table-sm table-hover mb-0">
          <thead><tr><th>ID</th><th>Type</th><th>Title</th><th>Date</th></tr></thead>
          <tbody>
            {lists.map((l: any) => (
              <tr key={l.id}><td>{l.id}</td><td><span className="badge bg-secondary">{l.type}</span></td><td>{l.title}</td><td>{l.date}</td></tr>
            ))}
            {!lists.length && <tr><td colSpan={4} className="text-muted text-center">No lists found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NotificationSettingsTab() {
  const [saved, setSaved] = useState(false);
  const [config, setConfig] = useState({
    smtp_host: 'mail.transtechologies.com', smtp_port: '587', smtp_user: 'support@transtechologies.com', smtp_pass: 'Cosinesine900**',
    sms_gateway: '', from_email: 'support@transtechologies.com', from_name: 'OpenRx Clinic',
  });

  const handleSave = () => {
    localStorage.setItem('openemr_notification_config', JSON.stringify(config));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Load saved config on mount
  useState(() => {
    try {
      const saved2 = localStorage.getItem('openemr_notification_config');
      if (saved2) setConfig(JSON.parse(saved2));
    } catch { /* ignore */ }
  });

  return (
    <div>
      <div className="row g-4">
        {/* Email (SMTP) */}
        <div className="col-md-6">
          <div className="card shadow-sm">
            <div className="card-header"><h5 className="mb-0"><i className="bi bi-envelope me-2"></i>Email (SMTP)</h5></div>
            <div className="card-body">
              <div className="mb-2"><label className="form-label small">SMTP Host</label><input className="form-control form-control-sm" placeholder="smtp.gmail.com" value={config.smtp_host} onChange={e => setConfig({...config, smtp_host: e.target.value})} /></div>
              <div className="mb-2"><label className="form-label small">Port</label><input className="form-control form-control-sm" value={config.smtp_port} onChange={e => setConfig({...config, smtp_port: e.target.value})} /></div>
              <div className="mb-2"><label className="form-label small">Username</label><input className="form-control form-control-sm" value={config.smtp_user} onChange={e => setConfig({...config, smtp_user: e.target.value})} /></div>
              <div className="mb-2"><label className="form-label small">Password</label><input className="form-control form-control-sm" type="password" value={config.smtp_pass} onChange={e => setConfig({...config, smtp_pass: e.target.value})} /></div>
              <div className="mb-2"><label className="form-label small">From Email</label><input className="form-control form-control-sm" placeholder="clinic@example.com" value={config.from_email} onChange={e => setConfig({...config, from_email: e.target.value})} /></div>
            </div>
          </div>
        </div>

        {/* SMS Gateway */}
        <div className="col-md-6">
          <div className="card shadow-sm">
            <div className="card-header"><h5 className="mb-0"><i className="bi bi-chat-dots me-2"></i>SMS Gateway</h5></div>
            <div className="card-body">
              <div className="mb-3">
                <label className="form-label small">SMS Gateway URL Template</label>
                <input className="form-control form-control-sm" placeholder="https://gateway.example.com/send?to={phone}&msg={message}" value={config.sms_gateway} onChange={e => setConfig({...config, sms_gateway: e.target.value})} />
                <small className="text-muted">Use {'{phone}'} and {'{message}'} as placeholders</small>
              </div>
              <div className="alert alert-info small mb-0">
                <i className="bi bi-info-circle me-1"></i>
                Common gateways: Twilio API, email-to-SMS (number@carrier.com), or custom HTTP endpoint
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <button className="btn btn-primary" onClick={handleSave}>
          <i className="bi bi-floppy me-1"></i>{saved ? 'Saved!' : 'Save Settings'}
        </button>
        <small className="text-muted ms-2">Settings saved locally. Once configured, email/SMS will be sent when checked on appointments.</small>
      </div>
    </div>
  );
}

function ChartTrackingTab() {
  const [charts, setCharts] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('chart_tracking') || '[]'); } catch { return []; }
  });
  const [form, setForm] = useState({ patientId: '', patientName: '', location: '', checkedOut: false });

  const addChart = () => {
    if (!form.patientId) return;
    const entry = { ...form, date: new Date().toISOString(), id: Date.now() };
    const updated = [...charts, entry];
    setCharts(updated);
    localStorage.setItem('chart_tracking', JSON.stringify(updated));
    setForm({ patientId: '', patientName: '', location: '', checkedOut: false });
  };

  const removeChart = (id: number) => {
    const updated = charts.filter(c => c.id !== id);
    setCharts(updated);
    localStorage.setItem('chart_tracking', JSON.stringify(updated));
  };

  const activeCharts = charts.filter(c => !c.checkedOut);

  return (
    <div>
      <div className="card shadow-sm mb-4">
        <div className="card-header"><h5 className="mb-0">Check In / Out Paper Chart</h5></div>
        <div className="card-body">
          <div className="row g-2">
            <div className="col-md-2"><input className="form-control form-control-sm" placeholder="Patient ID" value={form.patientId} onChange={e => setForm({...form, patientId: e.target.value})} /></div>
            <div className="col-md-3"><input className="form-control form-control-sm" placeholder="Patient Name" value={form.patientName} onChange={e => setForm({...form, patientName: e.target.value})} /></div>
            <div className="col-md-3"><input className="form-control form-control-sm" placeholder="Location (e.g. Room 3, File Cabinet A)" value={form.location} onChange={e => setForm({...form, location: e.target.value})} /></div>
            <div className="col-md-2"><button className="btn btn-primary btn-sm w-100" onClick={addChart} disabled={!form.patientId}>Check In Chart</button></div>
          </div>
        </div>
      </div>

      <div className="card shadow-sm">
        <div className="card-header d-flex justify-content-between"><h5 className="mb-0">Active Charts ({activeCharts.length})</h5></div>
        <div className="card-body p-0">
          <table className="table table-sm table-hover mb-0">
            <thead><tr><th>Patient ID</th><th>Name</th><th>Location</th><th>Date</th><th></th></tr></thead>
            <tbody>
              {charts.map(c => (
                <tr key={c.id} className={c.checkedOut ? 'text-muted text-decoration-line-through' : ''}>
                  <td>#{c.patientId}</td><td>{c.patientName}</td><td>{c.location || '—'}</td><td>{new Date(c.date).toLocaleDateString()}</td>
                  <td><button className="btn btn-outline-success btn-sm" onClick={() => removeChart(c.id)}>{c.checkedOut ? 'Returned' : 'Check Out'}</button></td>
                </tr>
              ))}
              {charts.length === 0 && <tr><td colSpan={5} className="text-muted text-center py-3">No charts tracked.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface SystemSettings {
  language: 'en' | 'fr';
  dateFormat: 'mm/dd/yyyy' | 'dd/mm/yyyy' | 'yyyy-mm-dd';
  timezone: string;
  timeFormat: '12h' | '24h';
  theme: 'light' | 'dark' | 'system';
  clinicName: string;
  clinicPhone: string;
  clinicEmail: string;
  defaultProvider: string;
}

const DEFAULT_SETTINGS: SystemSettings = {
  language: 'en',
  dateFormat: 'mm/dd/yyyy',
  timezone: 'America/New_York',
  timeFormat: '12h',
  theme: 'light',
  clinicName: 'OpenRx Clinic',
  clinicPhone: '',
  clinicEmail: '',
  defaultProvider: '',
};

const SETTINGS_KEY = 'openemr_system_settings';

const timezones = [
  { value: 'America/New_York', label: 'Eastern (UTC-5)' },
  { value: 'America/Chicago', label: 'Central (UTC-6)' },
  { value: 'America/Denver', label: 'Mountain (UTC-7)' },
  { value: 'America/Los_Angeles', label: 'Pacific (UTC-8)' },
  { value: 'America/Anchorage', label: 'Alaska (UTC-9)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (UTC-10)' },
  { value: 'Europe/London', label: 'London (UTC+0)' },
  { value: 'Europe/Paris', label: 'Paris (UTC+1)' },
  { value: 'Europe/Berlin', label: 'Berlin (UTC+1)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (UTC+9)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (UTC+8)' },
  { value: 'Australia/Sydney', label: 'Sydney (UTC+10)' },
];

function loadSettings(): SystemSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

function SettingsTab() {
  const [settings, setSettings] = useState<SystemSettings>(loadSettings);
  const [saved, setSaved] = useState(false);
  const [activeSection, setActiveSection] = useState<'general' | 'language' | 'legacy'>('general');

  const update = (patch: Partial<SystemSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    setSettings({ ...DEFAULT_SETTINGS });
    localStorage.removeItem(SETTINGS_KEY);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const legacyLinks = [
    { title: 'OAuth2 Clients', icon: 'bi-shield-lock', url: '/interface/smart/admin-client.php', desc: 'Manage OAuth2 client registrations' },
    { title: 'Practice Settings', icon: 'bi-gear', url: '/interface/super/edit_globals.php', desc: 'Configure global OpenRx settings' },
    { title: 'Modules', icon: 'bi-puzzle', url: '/interface/modules/zend_modules/public/index.php', desc: 'Manage installed modules' },
    { title: 'Database', icon: 'bi-database', url: '/sql_patch.php', desc: 'Database backup and SQL patching' },
  ];

  return (
    <div>
      {/* Section pills */}
      <div className="d-flex align-items-center justify-content-between mb-4">
        <ul className="nav nav-pills">
          {[
            { id: 'general' as const, label: 'General', icon: 'bi-gear' },
            { id: 'language' as const, label: 'Language & Region', icon: 'bi-translate' },
            { id: 'legacy' as const, label: 'Legacy Tools', icon: 'bi-link-45deg' },
          ].map((s) => (
            <li className="nav-item" key={s.id}>
              <button
                className={`nav-link ${activeSection === s.id ? 'active' : ''}`}
                onClick={() => setActiveSection(s.id)}
              >
                <i className={`bi ${s.icon} me-1`}></i>{s.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="d-flex gap-2">
          <button className="btn btn-outline-secondary btn-sm" onClick={handleReset}>
            <i className="bi bi-arrow-counterclockwise me-1"></i>Reset Defaults
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleSave}>
            <i className="bi bi-floppy me-1"></i>{saved ? 'Saved!' : 'Save Settings'}
          </button>
        </div>
      </div>

      {saved && (
        <div className="alert alert-success alert-dismissible fade show d-flex align-items-center" role="alert">
          <i className="bi bi-check-circle-fill me-2"></i>
          Settings saved successfully. Changes will take effect on next page refresh.
          <button type="button" className="btn-close" onClick={() => setSaved(false)}></button>
        </div>
      )}

      {/* ===== General Section ===== */}
      {activeSection === 'general' && (
        <div className="row g-4">
          <div className="col-md-6">
            <div className="card shadow-sm">
              <div className="card-header"><h5 className="mb-0"><i className="bi bi-building me-2"></i>Clinic Information</h5></div>
              <div className="card-body">
                <div className="mb-3">
                  <label className="form-label small fw-semibold">Clinic Name</label>
                  <input className="form-control form-control-sm" value={settings.clinicName}
                    onChange={e => update({ clinicName: e.target.value })} />
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-semibold">Phone Number</label>
                  <PhoneInput value={settings.clinicPhone} onChange={v => update({ clinicPhone: v })} />
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-semibold">Email Address</label>
                  <input className="form-control form-control-sm" placeholder="clinic@example.com" value={settings.clinicEmail}
                    onChange={e => update({ clinicEmail: e.target.value })} />
                </div>
                <div className="mb-0">
                  <label className="form-label small fw-semibold">Default Provider</label>
                  <input className="form-control form-control-sm" placeholder="Dr. Smith" value={settings.defaultProvider}
                    onChange={e => update({ defaultProvider: e.target.value })} />
                </div>
              </div>
            </div>
          </div>

          <div className="col-md-6">
            <div className="card shadow-sm">
              <div className="card-header"><h5 className="mb-0"><i className="bi bi-palette me-2"></i>Appearance</h5></div>
              <div className="card-body">
                <div className="mb-3">
                  <label className="form-label small fw-semibold">Theme</label>
                  <div className="d-flex gap-2">
                    {([
                      { value: 'light' as const, icon: 'bi-sun', label: 'Light' },
                      { value: 'dark' as const, icon: 'bi-moon', label: 'Dark' },
                      { value: 'system' as const, icon: 'bi-display', label: 'System' },
                    ]).map((t) => (
                      <button key={t.value}
                        className={`btn btn-sm flex-fill ${settings.theme === t.value ? 'btn-primary' : 'btn-outline-secondary'}`}
                        onClick={() => update({ theme: t.value })}>
                        <i className={`bi ${t.icon} me-1`}></i>{t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-semibold">Time Format</label>
                  <div className="d-flex gap-2">
                    <button className={`btn btn-sm flex-fill ${settings.timeFormat === '12h' ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={() => update({ timeFormat: '12h' })}>
                      12-Hour (2:30 PM)
                    </button>
                    <button className={`btn btn-sm flex-fill ${settings.timeFormat === '24h' ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={() => update({ timeFormat: '24h' })}>
                      24-Hour (14:30)
                    </button>
                  </div>
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-semibold">Date Format</label>
                  <select className="form-select form-select-sm" value={settings.dateFormat}
                    onChange={e => update({ dateFormat: e.target.value as SystemSettings['dateFormat'] })}>
                    <option value="mm/dd/yyyy">MM/DD/YYYY (US)</option>
                    <option value="dd/mm/yyyy">DD/MM/YYYY (International)</option>
                    <option value="yyyy-mm-dd">YYYY-MM-DD (ISO)</option>
                  </select>
                </div>
                <div className="mb-0">
                  <label className="form-label small fw-semibold">Timezone</label>
                  <select className="form-select form-select-sm" value={settings.timezone}
                    onChange={e => update({ timezone: e.target.value })}>
                    {timezones.map(tz => (
                      <option key={tz.value} value={tz.value}>{tz.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== Language & Region Section ===== */}
      {activeSection === 'language' && (
        <div className="row g-4">
          <div className="col-md-6">
            <div className="card shadow-sm border-primary">
              <div className="card-header bg-primary bg-opacity-10 border-primary">
                <h5 className="mb-0">
                  <i className="bi bi-translate me-2 text-primary"></i>
                  System Language
                </h5>
              </div>
              <div className="card-body">
                <p className="text-muted small mb-3">
                  Select the default language for the OpenRx interface. All menus, labels, and system messages will appear in the selected language.
                </p>

                <div className="row g-3">
                  <div className="col-6">
                    <button
                      className={`btn w-100 h-100 p-4 text-center ${settings.language === 'en' ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={() => update({ language: 'en' })}
                    >
                      <span style={{ fontSize: '3rem' }}>🇺🇸</span>
                      <h5 className="mt-2 mb-1">English</h5>
                      <span className="opacity-75 small">English (Default)</span>
                      {settings.language === 'en' && (
                        <div className="mt-2"><span className="badge bg-white text-primary small">Active</span></div>
                      )}
                    </button>
                  </div>
                  <div className="col-6">
                    <button
                      className={`btn w-100 h-100 p-4 text-center ${settings.language === 'fr' ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={() => update({ language: 'fr' })}
                    >
                      <span style={{ fontSize: '3rem' }}>🇫🇷</span>
                      <h5 className="mt-2 mb-1">Français</h5>
                      <span className="opacity-75 small">French / Français</span>
                      {settings.language === 'fr' && (
                        <div className="mt-2"><span className="badge bg-white text-primary small">Actif</span></div>
                      )}
                    </button>
                  </div>
                </div>

                <div className="alert alert-info small mt-3 mb-0 d-flex align-items-center">
                  <i className="bi bi-info-circle me-2"></i>
                  Language selection affects the entire application interface. Additional languages may be added by your system administrator via the legacy Language module.
                </div>
              </div>
            </div>

            <div className="card shadow-sm mt-4">
              <div className="card-header">
                <h5 className="mb-0"><i className="bi bi-geo-alt me-2"></i>Regional Settings</h5>
              </div>
              <div className="card-body">
                <div className="mb-3">
                  <label className="form-label small fw-semibold">Date Format</label>
                  <select className="form-select form-select-sm" value={settings.dateFormat}
                    onChange={e => update({ dateFormat: e.target.value as SystemSettings['dateFormat'] })}>
                    <option value="mm/dd/yyyy">MM/DD/YYYY (US)</option>
                    <option value="dd/mm/yyyy">DD/MM/YYYY (International)</option>
                    <option value="yyyy-mm-dd">YYYY-MM-DD (ISO)</option>
                  </select>
                  <div className="form-text">Preview: {new Date().toLocaleDateString(
                    settings.language === 'fr' ? 'fr-FR' : 'en-US',
                    { year: 'numeric', month: 'long', day: 'numeric' }
                  )}</div>
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-semibold">Time Format</label>
                  <div className="d-flex gap-2">
                    <button className={`btn btn-sm flex-fill ${settings.timeFormat === '12h' ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={() => update({ timeFormat: '12h' })}>12-Hour</button>
                    <button className={`btn btn-sm flex-fill ${settings.timeFormat === '24h' ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={() => update({ timeFormat: '24h' })}>24-Hour</button>
                  </div>
                </div>
                <div className="mb-0">
                  <label className="form-label small fw-semibold">Timezone</label>
                  <select className="form-select form-select-sm" value={settings.timezone}
                    onChange={e => update({ timezone: e.target.value })}>
                    {timezones.map(tz => (
                      <option key={tz.value} value={tz.value}>{tz.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="col-md-6">
            <div className="card shadow-sm">
              <div className="card-header">
                <h5 className="mb-0"><i className="bi bi-eye me-2"></i>Preview</h5>
              </div>
              <div className="card-body">
                <div className="border rounded p-4 bg-light">
                  <h6 className="mb-3">
                    {settings.language === 'fr' ? 'Paramètres de Langue' : 'Language Settings'}
                  </h6>

                  <div className="mb-3">
                    <label className="form-label small fw-semibold">
                      {settings.language === 'fr' ? 'Langue sélectionnée' : 'Selected Language'}
                    </label>
                    <div className="d-flex align-items-center gap-2 p-2 bg-white rounded border">
                      <span style={{ fontSize: '1.5rem' }}>
                        {settings.language === 'fr' ? '🇫🇷' : '🇺🇸'}
                      </span>
                      <div>
                        <strong>{settings.language === 'fr' ? 'Français' : 'English'}</strong>
                        <br />
                        <small className="text-muted">
                          {settings.language === 'fr' ? 'Interface en français' : 'English interface'}
                        </small>
                      </div>
                    </div>
                  </div>

                  <div className="row g-2 mb-3">
                    <div className="col-6">
                      <label className="form-label small fw-semibold">
                        {settings.language === 'fr' ? 'Format de date' : 'Date Format'}
                      </label>
                      <div className="bg-white border rounded p-2 small">
                        {new Date().toLocaleDateString(
                          settings.language === 'fr' ? 'fr-FR' : 'en-US',
                          { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
                        )}
                      </div>
                    </div>
                    <div className="col-6">
                      <label className="form-label small fw-semibold">
                        {settings.language === 'fr' ? 'Heure' : 'Time'}
                      </label>
                      <div className="bg-white border rounded p-2 small">
                        {new Date().toLocaleTimeString(
                          settings.language === 'fr' ? 'fr-FR' : 'en-US',
                          { hour: '2-digit', minute: '2-digit', hour12: settings.timeFormat === '12h' }
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-semibold">
                      {settings.language === 'fr' ? 'Exemple de bouton' : 'Sample Button'}
                    </label>
                    <button className="btn btn-primary btn-sm">
                      <i className="bi bi-check-circle me-1"></i>
                      {settings.language === 'fr' ? 'Enregistrer' : 'Save'}
                    </button>
                  </div>

                  <div className="mb-0">
                    <label className="form-label small fw-semibold">
                      {settings.language === 'fr' ? 'Message système' : 'System Message'}
                    </label>
                    <div className="alert alert-success small mb-0">
                      {settings.language === 'fr'
                        ? 'Paramètres enregistrés avec succès.'
                        : 'Settings saved successfully.'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== Legacy Tools Section ===== */}
      {activeSection === 'legacy' && (
        <div>
          <div className="alert alert-info d-flex align-items-center mb-4">
            <i className="bi bi-info-circle-fill me-2"></i>
            These functions open in the legacy PHP interface (not yet migrated to SPA).
          </div>
          <div className="row g-3">
            {legacyLinks.map(link => (
              <div className="col-md-3" key={link.title}>
                <a href={link.url} target="_blank" rel="noreferrer" className="text-decoration-none">
                  <div className="card h-100 shadow-sm legacy-link-card">
                    <div className="card-body text-center p-4">
                      <i className={`bi ${link.icon} text-primary`} style={{ fontSize: '2rem' }}></i>
                      <h6 className="mt-2 mb-1">{link.title}</h6>
                      <p className="text-muted small mb-0">{link.desc}</p>
                    </div>
                  </div>
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pending Registrations Tab (admin review) ──────────────────
function PendingRegistrationsTab() {
  const queryClient = useQueryClient();

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ['pending-registrations'],
    queryFn: async () => { const r = await nestClient.get('/admin/pending-registrations'); return r.data; },
    refetchInterval: 30000,
  });

  const approve = useMutation({
    mutationFn: (id: number) => nestClient.put(`/admin/users/${id}/approve`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pending-registrations'] }),
  });

  const reject = useMutation({
    mutationFn: (id: number) => nestClient.put(`/admin/users/${id}/reject`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pending-registrations'] }),
  });

  if (isLoading) return <div className="text-center py-4"><div className="spinner-border text-primary" /></div>;

  return (
    <div>
      <div className="alert alert-warning small d-flex align-items-center gap-2 mb-3">
        <i className="bi bi-info-circle fs-5"></i>
        <div>
          <strong>30-Day Review Window:</strong> Pending registrations must be approved or rejected within 30 days.
          After 30 days, un-reviewed applications will be auto-rejected.
        </div>
      </div>

      {pending.length === 0 ? (
        <div className="text-center py-5 text-muted">
          <i className="bi bi-check-circle" style={{ fontSize: '3rem' }}></i>
          <h5 className="mt-2">No pending registrations</h5>
          <p className="small">All staff applications have been reviewed.</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-sm table-hover align-middle">
            <thead className="table-light">
              <tr>
                <th>ID</th><th>Name</th><th>Username</th><th>Title</th>
                <th>Specialty</th><th>Email</th><th>Registered</th>
                <th>Days Left</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((u: any) => {
                const daysLeft = u.days_until_auto_reject ?? 30;
                const urgent = daysLeft <= 5;
                return (
                  <tr key={u.id} className={urgent ? 'table-warning' : ''}>
                    <td><code>{u.id}</code></td>
                    <td><strong>{u.fname} {u.lname}</strong></td>
                    <td>{u.username}</td>
                    <td>{u.title || '—'}</td>
                    <td>{u.specialty || '—'}</td>
                    <td><small>{u.email || '—'}</small></td>
                    <td><small>{new Date(u.date_created).toLocaleDateString()}</small></td>
                    <td>
                      <span className={`badge ${urgent ? 'bg-danger' : daysLeft <= 14 ? 'bg-warning text-dark' : 'bg-success'}`}>
                        {daysLeft} day{daysLeft !== 1 ? 's' : ''}
                      </span>
                    </td>
                    <td>
                      <div className="d-flex gap-1">
                        <button className="btn btn-success btn-sm"
                          onClick={() => approve.mutate(u.id)}
                          disabled={approve.isPending}>
                          <i className="bi bi-check-lg me-1"></i>Approve
                        </button>
                        <button className="btn btn-outline-danger btn-sm"
                          onClick={() => reject.mutate(u.id)}
                          disabled={reject.isPending}>
                          <i className="bi bi-x-lg me-1"></i>Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Menu access control ──────────────────────────────────────────────────

function MenuAccessTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'menu-permissions'],
    queryFn: async () => (await nestClient.get('/admin/menu-permissions')).data,
  });
  const setMut = useMutation({
    mutationFn: (d: any) => nestClient.put('/admin/menu-permissions', d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'menu-permissions'] }),
  });

  if (isLoading) {
    return <div className="text-center py-5"><div className="spinner-border text-primary" /></div>;
  }

  const { roles = [], menuItems = [], permissions = {} } = data || {};

  return (
    <div className="card border-0 shadow-sm" style={{ borderRadius: '16px', position: 'relative', zIndex: 1 }}>
      <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
        <h6 className="mb-1 fw-bold"><i className="bi bi-menu-button-wide me-2 text-primary"></i>Menu Access by Role</h6>
        <small className="text-muted">Toggle which sidebar menu items each role can see. Changes apply immediately.</small>
      </div>
      <div className="card-body p-0" style={{ overflowX: 'auto' }}>
        <table className="table table-sm align-middle mb-0" style={{ minWidth: '960px' }}>
          <thead className="table-light">
            <tr>
              <th style={{ position: 'sticky', left: 0, background: '#f8f9fa', minWidth: '230px', zIndex: 1 }}>Menu Item</th>
              {roles.map((r: string) => (
                <th key={r} className="text-center text-capitalize" style={{ fontSize: '0.7rem' }}>{r.replace(/_/g, ' ')}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {menuItems.map((m: any) => (
              <tr key={m.key}>
                <td style={{ position: 'sticky', left: 0, background: '#fff', whiteSpace: 'nowrap' }}>
                  <span className="badge bg-light text-dark border me-1" style={{ fontSize: '0.6rem' }}>{m.section}</span>
                  <span className="small">{m.label}</span>
                </td>
                {roles.map((role: string) => {
                  const enabled = permissions[role]?.[m.key] !== false;
                  return (
                    <td key={role} className="text-center">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={enabled}
                        onChange={(e) => setMut.mutate({ role, menuKey: m.key, enabled: e.target.checked })}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Lab Delete Codes
 * Administrators issue a one-time 4-digit code to a lab user or provider so
 * that user can delete a validated lab result already filed in the chart.
 * ────────────────────────────────────────────────────────────────────────── */
function LabDeleteCodesTab() {
  const qc = useQueryClient();
  const [targetUserId, setTargetUserId] = useState('');
  const [validMinutes, setValidMinutes] = useState(60);
  const [note, setNote] = useState('');
  const [issued, setIssued] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: users = [] } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => (await nestClient.get('/admin/users')).data,
  });

  const { data: codes = [], isLoading } = useQuery({
    queryKey: ['lab-delete-authorizations'],
    queryFn: async () => (await nestClient.get('/lab/delete-authorizations')).data,
    refetchInterval: 20000,
  });

  const eligibleUsers = (users as any[]).filter(u =>
    ['lab_tech', 'standard'].includes(u.main_menu_role),
  );

  const issue = useMutation({
    mutationFn: (d: any) => nestClient.post('/lab/delete-authorizations', d),
    onSuccess: (res: any) => {
      setIssued(res.data);
      setNote('');
      setCopied(false);
      qc.invalidateQueries({ queryKey: ['lab-delete-authorizations'] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: number) => nestClient.delete(`/lab/delete-authorizations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lab-delete-authorizations'] }),
  });

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const roleLabel = (role: string) =>
    role === 'lab_tech' ? 'Lab Tech' : role === 'physician' ? 'Provider' : (role || '—');

  const statusOf = (c: any) => {
    if (c.revoked_at) return { label: 'Revoked', cls: 'bg-secondary' };
    if (c.used_at) return { label: 'Used', cls: 'bg-success' };
    if (c.is_active === 1 || c.is_active === true) return { label: 'Active', cls: 'bg-primary' };
    return { label: 'Expired', cls: 'bg-light text-dark border' };
  };

  return (
    <div>
      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: '16px' }}>
        <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
          <h6 className="mb-1 fw-bold"><i className="bi bi-shield-lock me-2 text-danger"></i>Send a Lab Deletion Code</h6>
          <small className="text-muted">
            A validated lab filed in a patient chart can only be removed with a one-time code. Generate a code, then relay
            it to the lab user or provider — they enter it when deleting the result.
          </small>
        </div>
        <div className="card-body">
          <div className="row g-2 align-items-end">
            <div className="col-md-5">
              <label className="form-label small mb-1">Recipient (lab staff or provider)</label>
              <select className="form-select form-select-sm" value={targetUserId}
                onChange={e => setTargetUserId(e.target.value)}>
                <option value="">— Select user —</option>
                {eligibleUsers.map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {[u.fname, u.lname].filter(Boolean).join(' ')} ({u.username}) · {roleLabel(u.main_menu_role)}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label small mb-1">Valid for</label>
              <select className="form-select form-select-sm" value={validMinutes}
                onChange={e => setValidMinutes(Number(e.target.value))}>
                {[15, 30, 60, 120, 240, 480, 1440].map(m => (
                  <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} hr`}</option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label small mb-1">Note (optional)</label>
              <input className="form-control form-control-sm" placeholder="Reason / reference"
                value={note} onChange={e => setNote(e.target.value)} />
            </div>
            <div className="col-md-2">
              <button className="btn btn-danger btn-sm w-100 rounded-pill"
                disabled={!targetUserId || issue.isPending}
                onClick={() => issue.mutate({ targetUserId: Number(targetUserId), validMinutes, note })}>
                {issue.isPending ? 'Generating…' : <><i className="bi bi-key me-1"></i>Generate code</>}
              </button>
            </div>
          </div>

          {issue.isError && (
            <div className="alert alert-danger py-2 px-3 mt-3 small mb-0">
              <i className="bi bi-exclamation-triangle me-1"></i>
              {(issue.error as any)?.response?.data?.message || 'Could not generate the code.'}
            </div>
          )}

          {issued && (
            <div className="alert alert-success mt-3 mb-0">
              <div className="fw-bold mb-1">
                <i className="bi bi-check-circle me-1"></i>
                Code issued for {issued.target_username} ({roleLabel(issued.target_role)})
              </div>
              <div className="d-flex align-items-center gap-3 flex-wrap">
                <span className="display-6 fw-bold font-monospace" style={{ letterSpacing: '0.3rem' }}>{issued.code}</span>
                <button className="btn btn-outline-success btn-sm rounded-pill" onClick={() => copyCode(issued.code)}>
                  <i className={`bi ${copied ? 'bi-check-lg' : 'bi-clipboard'} me-1`}></i>{copied ? 'Copied' : 'Copy code'}
                </button>
                <span className="small">
                  Expires {issued.expires_at ? new Date(issued.expires_at).toLocaleString() : '—'} · single use
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
        <div className="card-header bg-white py-3 d-flex justify-content-between align-items-center" style={{ borderRadius: '16px 16px 0 0' }}>
          <h6 className="mb-0 fw-bold"><i className="bi bi-clock-history me-2 text-primary"></i>Issued Codes ({codes.length})</h6>
          <small className="text-muted">Active, used, revoked and expired codes</small>
        </div>
        <div className="card-body p-0">
          {isLoading ? (
            <div className="text-center py-4"><div className="spinner-border spinner-border-sm text-primary" /></div>
          ) : codes.length === 0 ? (
            <div className="text-center text-muted small py-4">No codes issued yet.</div>
          ) : (
            <div style={{ maxHeight: '560px', overflowY: 'auto' }}>
              <table className="table table-sm align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Recipient</th><th>Role</th><th>Code</th><th>Issued by</th>
                    <th>Expires</th><th>Status</th><th className="text-end">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((c: any) => {
                    const st = statusOf(c);
                    const isActive = st.label === 'Active';
                    return (
                      <tr key={c.id}>
                        <td>
                          <div className="small fw-semibold">{c.target_name || c.target_username || `#${c.target_user_id}`}</div>
                          <div className="text-muted" style={{ fontSize: '0.7rem' }}>
                            {c.target_email || c.target_phone || ''}
                          </div>
                        </td>
                        <td><span className="badge bg-light text-dark border">{roleLabel(c.target_role)}</span></td>
                        <td><code className="fs-6">{c.code}</code></td>
                        <td className="small text-muted">{c.issued_by_name || (c.issued_by ? `#${c.issued_by}` : '—')}</td>
                        <td className="small text-nowrap">{c.expires_at ? new Date(c.expires_at).toLocaleString() : '—'}</td>
                        <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                        <td className="text-end">
                          {isActive ? (
                            <button className="btn btn-sm btn-outline-danger py-0 px-1" title="Revoke code"
                              disabled={revoke.isPending}
                              onClick={() => revoke.mutate(c.id)}>
                              <i className="bi bi-x-circle"></i>
                            </button>
                          ) : (
                            <span className="text-muted small">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

