import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import nestClient from '../../api/nest-client';
import PhoneInput from '../../components/shared/PhoneInput';
import CitySelect from '../../components/shared/CitySelect';

const calendarColors = ['#0d6efd', '#198754', '#dc3545', '#fd7e14', '#6f42c1', '#20c997', '#0dcaf0', '#ffc107', '#e83e8c'];

export default function ProvidersPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const canEditProviders = user?.role === 'admin' || user?.can_edit_providers === true;
  const [showForm, setShowForm] = useState(false);
  const [editProvider, setEditProvider] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    username: '', fname: '', mname: '', lname: '', suffix: '', title: '',
    specialty: '', physician_type: '', npi: '', upin: '', taxonomy: '207Q00000X',
    federaldrugid: '', facility_id: '', calendar_color: '#0d6efd',
    email: '', email_direct: '', phone: '', fax: '', phonew1: '', phonew2: '', phonecell: '',
    street: '', city: '',
    organization: '', assistant: '', state_license_number: '',
    weno_prov_id: '', newcrop_user_role: '', cpoe: 0,
  });

  const { data: providers = [] } = useQuery({
    queryKey: ['providers'],
    queryFn: async () => { const r = await nestClient.get('/admin/users'); return r.data; },
  });

  const { data: facilities = [] } = useQuery({
    queryKey: ['facilities-list'],
    queryFn: async () => { const r = await nestClient.get('/facilities'); return r.data; },
  });

  const { data: specialtiesData } = useQuery({
    queryKey: ['specialties'],
    queryFn: async () => { const r = await nestClient.get('/admin/specialties'); return r.data; },
  });

  // Fetch avatars for all providers
  const { data: avatarUrls = {} } = useQuery({
    queryKey: ['provider-avatars', providers.map((p: any) => p.id).join(',')],
    queryFn: async () => {
      const urls: Record<string, string> = {};
      await Promise.all(providers.map(async (p: any) => {
        try {
          const r = await nestClient.get(`/avatars/${p.id}`);
          if (r.data?.url) urls[String(p.id)] = r.data.url;
        } catch { /* no avatar */ }
      }));
      return urls;
    },
    enabled: providers.length > 0,
    staleTime: 60000,
  });

  const physicianTypes = specialtiesData?.physicianTypes || [];
  const taxonomyCodes = specialtiesData?.taxonomyCodes || [];
  const existingSpecialties = specialtiesData?.existing || [];

  const createProvider = useMutation({
    mutationFn: (d: any) => nestClient.post('/admin/users', d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['providers'] }); resetForm(); },
  });

  const updateProvider = useMutation({
    mutationFn: (d: any) => nestClient.put(`/admin/users/${editProvider?.id}`, d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['providers'] }); setEditProvider(null); resetForm(); },
  });

  const toggleActive = useMutation({
    mutationFn: (p: any) => nestClient.put(`/admin/users/${p.id}`, { active: p.active ? 0 : 1 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['providers'] }),
  });

  const uploadAvatar = useMutation({
    mutationFn: async ({ userId: _userId, file }: { userId: number; file: File }) => {
      const fd = new FormData();
      fd.append('file', file);
      return nestClient.post('/avatars/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider-avatars'] });
      setUploadingFor(null);
    },
  });

  const handleAvatarClick = (providerId: number) => {
    setUploadingFor(providerId);
    setTimeout(() => fileRef.current?.click(), 50);
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && uploadingFor !== null) {
      uploadAvatar.mutate({ userId: uploadingFor, file });
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const resetForm = () => {
    setForm({
      username: '', fname: '', mname: '', lname: '', suffix: '', title: '',
      specialty: '', physician_type: '', npi: '', upin: '', taxonomy: '207Q00000X',
      federaldrugid: '', facility_id: '', calendar_color: '#0d6efd',
      email: '', email_direct: '', phone: '', fax: '', phonew1: '', phonew2: '', phonecell: '',
      street: '', city: '',
      organization: '', assistant: '', state_license_number: '',
      weno_prov_id: '', newcrop_user_role: '', cpoe: 0,
    });
    setShowForm(false);
    setEditProvider(null);
  };

  const startEdit = (p: any) => {
    setEditProvider(p);
    setForm({
      username: p.username || '', fname: p.fname || '', mname: p.mname || '', lname: p.lname || '',
      suffix: p.suffix || '', title: p.title || '',
      specialty: p.specialty || '', physician_type: p.physician_type || '',
      npi: p.npi || '', upin: p.upin || '', taxonomy: p.taxonomy || '207Q00000X',
      federaldrugid: p.federaldrugid || '', facility_id: p.facility_id || '',
      calendar_color: p.calendar_color || '#0d6efd',
      email: p.email || '', email_direct: p.email_direct || '',
      phone: p.phone || '', fax: p.fax || '', phonew1: p.phonew1 || '', phonew2: p.phonew2 || '', phonecell: p.phonecell || '',
      street: p.street || '', city: p.city || '',
      organization: p.organization || '', assistant: p.assistant || '',
      state_license_number: p.state_license_number || '',
      weno_prov_id: p.weno_prov_id || '', newcrop_user_role: p.newcrop_user_role || '', cpoe: p.cpoe || 0,
    });
    setShowForm(true);
  };

  const setField = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }));

  const filtered = providers
    .filter((p: any) => showInactive ? true : p.active)
    .filter((p: any) => {
      if (!search) return true;
      const s = search.toLowerCase();
      return `${p.fname} ${p.lname} ${p.specialty || ''} ${p.npi || ''} ${p.username || ''}`.toLowerCase().includes(s);
    });

  const activeCount = providers.filter((p: any) => p.active).length;
  const withNpi = providers.filter((p: any) => p.npi).length;
  const withSpecialty = providers.filter((p: any) => p.specialty).length;

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
      {/* Hidden file input for avatar upload */}
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileSelected} />

      {/* Header */}
      <div className="rounded-4 p-4 mb-4 text-white position-relative overflow-hidden" style={{
        background: 'linear-gradient(135deg, #6f42c1 0%, #4b2d8e 30%, #0d6efd 70%, #0dcaf0 100%)',
      }}>
        <div className="position-absolute end-0 top-0 opacity-10" style={{ fontSize: '8rem', transform: 'rotate(15deg) translate(20px,-20px)' }}>
          <i className="bi bi-person-badge"></i>
        </div>
        <div className="position-relative">
          <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
            <div>
              <h2 className="mb-1 fw-bold"><i className="bi bi-person-badge me-2"></i>Provider Directory</h2>
              <p className="mb-0 text-white text-opacity-75 small">
                {activeCount} active · {providers.length} total · Manage credentials, specialties & scheduling
              </p>
            </div>
            {canEditProviders && (
              <button className="btn btn-light btn-lg rounded-pill shadow-sm" onClick={() => { setShowForm(true); setEditProvider(null); }}>
                <i className="bi bi-plus-lg me-2"></i>Add Provider
              </button>
            )}
            {!canEditProviders && user?.role === 'front_desk' && (
              <div className="alert alert-warning py-1 px-3 mb-0 rounded-pill" style={{ fontSize: '0.8rem' }}>
                <i className="bi bi-info-circle me-1"></i>
                You need admin permission to add or edit providers.
              </div>
            )}
          </div>
          <div className="row g-2 mt-3">
            {[
              { v: activeCount, l: 'Active', c: '#198754', i: 'bi-check-circle' },
              { v: withNpi, l: 'With NPI', c: '#0dcaf0', i: 'bi-upc' },
              { v: withSpecialty, l: 'Specialized', c: '#ffc107', i: 'bi-star' },
            ].map(s => (
              <div className="col-auto" key={s.l}>
                <div className="d-flex align-items-center gap-2 bg-white bg-opacity-15 rounded-pill px-3 py-1">
                  <i className={`bi ${s.i} small`} style={{ color: s.c }}></i>
                  <span className="fw-bold small">{s.v}</span>
                  <span className="small text-white text-opacity-75">{s.l}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="d-flex gap-2 mb-3 flex-wrap">
        <div className="input-group flex-grow-1" style={{ maxWidth: '400px' }}>
          <span className="input-group-text bg-white border-end-0 rounded-pill-start">
            <i className="bi bi-search text-muted"></i>
          </span>
          <input className="form-control border-start-0 rounded-pill-end" placeholder="Search by name, specialty, NPI..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button
          className={`btn rounded-pill ${showInactive ? 'btn-secondary' : 'btn-outline-secondary'}`}
          onClick={() => setShowInactive(!showInactive)}>
          <i className={`bi ${showInactive ? 'bi-eye-slash' : 'bi-eye'} me-1`}></i>
          {showInactive ? 'Hide Inactive' : 'Show All'}
        </button>
        <span className="badge bg-primary rounded-pill fs-6 ms-auto d-flex align-items-center px-3">
          {filtered.length} provider{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Provider Cards Grid */}
      <div className="row g-3">
        {filtered.map((p: any) => {
          const initials = `${p.fname?.[0] || ''}${p.lname?.[0] || ''}`;
          const facility = facilities.find((f: any) => String(f.id) === String(p.facility_id));
          const avatarUrl = avatarUrls[String(p.id)];
          const isUploading = uploadingFor === p.id && uploadAvatar.isPending;
          return (
            <div className="col-xl-4 col-lg-6" key={p.id}>
              <div className={`card border-0 shadow-sm h-100 transition-all ${!p.active ? 'opacity-50' : ''}`}
                style={{ borderRadius: '20px', overflow: 'hidden' }}>
                <div style={{ height: '4px', backgroundColor: p.calendar_color || '#0d6efd' }}></div>

                <div className="card-body pt-3">
                  {/* Avatar + Name Row */}
                  <div className="d-flex align-items-start gap-3 mb-3">
                    {/* Avatar */}
                    <div className="position-relative flex-shrink-0" style={{ width: '64px', height: '64px' }}>
                      {avatarUrl ? (
                        <img src={avatarUrl} alt={`${p.fname} ${p.lname}`}
                          className="rounded-circle shadow-sm"
                          style={{ width: '64px', height: '64px', objectFit: 'cover' }} />
                      ) : (
                        <div className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold shadow-sm"
                          style={{
                            width: '64px', height: '64px', fontSize: '1.4rem',
                            background: `linear-gradient(135deg, ${p.calendar_color || '#0d6efd'}, ${p.calendar_color ? p.calendar_color + 'cc' : '#0d6efdcc'})`,
                          }}>
                          {initials}
                        </div>
                      )}
                      {/* Upload overlay button */}
                      <button
                        className="btn btn-dark btn-sm rounded-circle position-absolute bottom-0 end-0 shadow"
                        style={{ width: '28px', height: '28px', padding: 0, fontSize: '0.7rem', transform: 'translate(4px, 4px)' }}
                        onClick={() => handleAvatarClick(p.id)}
                        disabled={isUploading}
                        title="Upload profile photo"
                      >
                        {isUploading ? (
                          <span className="spinner-border spinner-border-sm" style={{ width: '12px', height: '12px' }}></span>
                        ) : (
                          <i className="bi bi-camera"></i>
                        )}
                      </button>
                    </div>

                    <div className="flex-grow-1 min-w-0">
                      <h6 className="mb-0 fw-bold text-truncate">
                        {p.title ? `${p.title} ` : ''}{p.fname} {p.lname}
                        {p.suffix && <small className="text-muted">, {p.suffix}</small>}
                      </h6>
                      <div className="d-flex flex-wrap gap-1 mt-1">
                        {p.specialty && (
                          <span className="badge bg-light text-dark border" style={{ fontSize: '0.7rem' }}>
                            <i className="bi bi-mortarboard me-1"></i>{p.specialty}
                          </span>
                        )}
                        {p.physician_type && (
                          <span className="badge bg-light text-muted border" style={{ fontSize: '0.7rem' }}>
                            {p.physician_type.replace(/_/g, ' ')}
                          </span>
                        )}
                        <span className={`badge ${p.active ? 'bg-success' : 'bg-secondary'}`} style={{ fontSize: '0.7rem' }}>
                          {p.active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Info rows */}
                  <div className="small text-muted mb-3">
                    {p.npi && (
                      <div className="d-flex align-items-center gap-2 mb-1">
                        <i className="bi bi-upc text-primary" style={{ width: '18px' }}></i>
                        <code className="small">{p.npi}</code>
                      </div>
                    )}
                    {p.email && (
                      <div className="d-flex align-items-center gap-2 mb-1 text-truncate">
                        <i className="bi bi-envelope text-info" style={{ width: '18px' }}></i>
                        <span>{p.email}</span>
                      </div>
                    )}
                    {p.phone && (
                      <div className="d-flex align-items-center gap-2 mb-1">
                        <i className="bi bi-telephone text-success" style={{ width: '18px' }}></i>
                        <span>{p.phone}</span>
                      </div>
                    )}
                    {facility && (
                      <div className="d-flex align-items-center gap-2 mb-1">
                        <i className="bi bi-building text-secondary" style={{ width: '18px' }}></i>
                        <span>{facility.name}</span>
                      </div>
                    )}
                    {p.state_license_number && (
                      <div className="d-flex align-items-center gap-2">
                        <i className="bi bi-shield-check text-warning" style={{ width: '18px' }}></i>
                        <span>License: {p.state_license_number}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Footer Actions */}
                <div className="card-footer bg-white border-top d-flex gap-2 py-2">
                  {canEditProviders && (
                    <button className="btn btn-outline-primary btn-sm rounded-pill flex-grow-1"
                      onClick={() => startEdit(p)}>
                      <i className="bi bi-pencil me-1"></i>Edit
                    </button>
                  )}
                  <button className="btn btn-outline-info btn-sm rounded-pill"
                    onClick={() => navigate(`/providers/${p.id}`)}>
                    <i className="bi bi-eye"></i>
                  </button>
                  <button
                    className={`btn btn-sm rounded-pill ${p.active ? 'btn-outline-danger' : 'btn-outline-success'}`}
                    onClick={() => toggleActive.mutate(p)}
                  >
                    <i className={`bi ${p.active ? 'bi-toggle-off' : 'bi-toggle-on'}`}></i>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-12 text-center py-5 text-muted">
            <i className="bi bi-person-x fs-1 d-block mb-2 opacity-25"></i>
            <p>No providers found{search ? ` matching "${search}"` : ''}.</p>
          </div>
        )}
      </div>

      {/* Slide-in Form Overlay */}
      {showForm && (
        <div className="position-fixed top-0 end-0 h-100 shadow-lg bg-white" style={{
          width: '100%', maxWidth: '700px', zIndex: 1055, overflowY: 'auto',
          animation: 'slideInRight 0.3s ease-out',
        }}>
          <style>{`@keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
          <div className="position-fixed top-0 start-0 w-100 h-100 bg-dark bg-opacity-50" style={{ zIndex: -1 }}
            onClick={resetForm}></div>

          <div className="sticky-top text-white p-4" style={{ background: 'linear-gradient(135deg, #6f42c1, #0d6efd)' }}>
            <div className="d-flex justify-content-between align-items-center">
              <h5 className="mb-0 fw-bold">
                <i className={`bi ${editProvider ? 'bi-pencil' : 'bi-person-plus'} me-2`}></i>
                {editProvider ? `Edit: ${editProvider.fname} ${editProvider.lname}` : 'Add New Provider'}
              </h5>
              <button className="btn btn-sm btn-outline-light rounded-circle" style={{ width: '36px', height: '36px' }}
                onClick={resetForm}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
          </div>

          <div className="p-4">
            {/* Avatar upload in form */}
            {editProvider && (
              <div className="text-center mb-3">
                <div className="position-relative d-inline-block">
                  {avatarUrls[String(editProvider.id)] ? (
                    <img src={avatarUrls[String(editProvider.id)]}
                      className="rounded-circle shadow" style={{ width: '80px', height: '80px', objectFit: 'cover' }} />
                  ) : (
                    <div className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold shadow mx-auto"
                      style={{
                        width: '80px', height: '80px', fontSize: '1.7rem',
                        background: `linear-gradient(135deg, ${editProvider.calendar_color || '#0d6efd'}, ${editProvider.calendar_color ? editProvider.calendar_color + 'cc' : '#0d6efdcc'})`,
                      }}>
                      {editProvider.fname?.[0]}{editProvider.lname?.[0]}
                    </div>
                  )}
                  <button className="btn btn-primary btn-sm rounded-circle position-absolute bottom-0 end-0 shadow"
                    style={{ width: '30px', height: '30px', padding: 0 }}
                    onClick={() => handleAvatarClick(editProvider.id)}
                    disabled={uploadingFor === editProvider.id && uploadAvatar.isPending}>
                    <i className="bi bi-camera small"></i>
                  </button>
                </div>
                <div className="small text-muted mt-1">Click to upload profile photo</div>
              </div>
            )}

            {/* Personal Info */}
            <h6 className="text-uppercase small fw-bold text-primary mb-2">
              <i className="bi bi-person me-2"></i>Personal Information
            </h6>
            <div className="row g-2 mb-3">
              <div className="col-6 col-md-3">
                <label className="form-label small fw-semibold">Title</label>
                <select className="form-select form-select-sm" value={form.title} onChange={e => setField('title', e.target.value)}>
                  <option value="">—</option>
                  <option value="Dr.">Dr.</option><option value="MD">MD</option><option value="DO">DO</option>
                  <option value="NP">NP</option><option value="PA">PA</option><option value="RN">RN</option>
                  <option value="LPN">LPN</option><option value="Mr.">Mr.</option><option value="Ms.">Ms.</option>
                </select>
              </div>
              <div className="col-6 col-md-3"><label className="form-label small fw-semibold">Username *</label><input className="form-control form-control-sm" value={form.username} onChange={e => setField('username', e.target.value)} /></div>
              <div className="col-6 col-md-3"><label className="form-label small fw-semibold">First Name *</label><input className="form-control form-control-sm" value={form.fname} onChange={e => setField('fname', e.target.value)} /></div>
              <div className="col-6 col-md-3"><label className="form-label small fw-semibold">Last Name *</label><input className="form-control form-control-sm" value={form.lname} onChange={e => setField('lname', e.target.value)} /></div>
              <div className="col-6 col-md-3"><label className="form-label small">Middle</label><input className="form-control form-control-sm" value={form.mname} onChange={e => setField('mname', e.target.value)} /></div>
              <div className="col-6 col-md-3">
                <label className="form-label small">Suffix</label>
                <select className="form-select form-select-sm" value={form.suffix} onChange={e => setField('suffix', e.target.value)}>
                  <option value="">—</option><option value="Jr.">Jr.</option><option value="Sr.">Sr.</option>
                  <option value="II">II</option><option value="III">III</option>
                </select>
              </div>
            </div>

            {/* Credentials */}
            <h6 className="text-uppercase small fw-bold text-primary mb-2"><i className="bi bi-award me-2"></i>Credentials & Taxonomy</h6>
            <div className="row g-2 mb-3">
              <div className="col-md-4">
                <label className="form-label small fw-semibold">Physician Type</label>
                <select className="form-select form-select-sm" value={form.physician_type} onChange={e => setField('physician_type', e.target.value)}>
                  <option value="">— Select —</option>
                  {physicianTypes.map((pt: any) => (<option key={pt.option_id} value={pt.option_id}>{pt.title}</option>))}
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label small fw-semibold">Specialty</label>
                <input className="form-control form-control-sm" list="specialty-list" value={form.specialty} onChange={e => setField('specialty', e.target.value)} placeholder="e.g. Family Medicine" />
                <datalist id="specialty-list">{existingSpecialties.map((s: any) => <option key={s.specialty} value={s.specialty} />)}</datalist>
              </div>
              <div className="col-md-4">
                <label className="form-label small fw-semibold">Calendar Color</label>
                <div className="d-flex gap-1 flex-wrap mb-1">
                  {calendarColors.map(c => (
                    <span key={c} className="rounded-circle shadow-sm" style={{
                      width: '24px', height: '24px', backgroundColor: c, cursor: 'pointer',
                      border: form.calendar_color === c ? '3px solid #212529' : '3px solid transparent',
                      transform: form.calendar_color === c ? 'scale(1.2)' : 'scale(1)',
                    }} onClick={() => setField('calendar_color', c)}></span>
                  ))}
                </div>
              </div>
              <div className="col-md-3"><label className="form-label small fw-semibold">NPI Number</label><input className="form-control form-control-sm" value={form.npi} onChange={e => setField('npi', e.target.value)} placeholder="1234567890" /></div>
              <div className="col-md-3"><label className="form-label small fw-semibold">UPIN</label><input className="form-control form-control-sm" value={form.upin} onChange={e => setField('upin', e.target.value)} /></div>
              <div className="col-md-3">
                <label className="form-label small fw-semibold">Taxonomy Code</label>
                <select className="form-select form-select-sm" value={form.taxonomy} onChange={e => setField('taxonomy', e.target.value)}>
                  <option value="207Q00000X">207Q00000X — Family Medicine</option>
                  {taxonomyCodes.map((tc: any) => (<option key={tc.option_id} value={tc.option_id}>{tc.option_id} — {tc.title}</option>))}
                </select>
              </div>
              <div className="col-md-3"><label className="form-label small fw-semibold">State License #</label><input className="form-control form-control-sm" value={form.state_license_number} onChange={e => setField('state_license_number', e.target.value)} /></div>
              <div className="col-md-3"><label className="form-label small fw-semibold">Federal Drug ID</label><input className="form-control form-control-sm" value={form.federaldrugid} onChange={e => setField('federaldrugid', e.target.value)} /></div>
            </div>

            {/* Contact */}
            <h6 className="text-uppercase small fw-bold text-primary mb-2"><i className="bi bi-telephone me-2"></i>Contact Information</h6>
            <div className="row g-2 mb-3">
              <div className="col-md-4"><label className="form-label small fw-semibold">Email</label><input className="form-control form-control-sm" type="email" value={form.email} onChange={e => setField('email', e.target.value)} /></div>
              <div className="col-md-4"><label className="form-label small fw-semibold">Direct Email (HISP)</label><input className="form-control form-control-sm" type="email" value={form.email_direct} onChange={e => setField('email_direct', e.target.value)} /></div>
              <div className="col-md-4"><label className="form-label small fw-semibold">Phone</label><PhoneInput value={form.phone} onChange={v => setField('phone', v)} /></div>
              <div className="col-md-4"><label className="form-label small">Work Phone</label><PhoneInput value={form.phonew1} onChange={v => setField('phonew1', v)} /></div>
              <div className="col-md-4"><label className="form-label small">Cell</label><PhoneInput value={form.phonecell} onChange={v => setField('phonecell', v)} /></div>
              <div className="col-md-4"><label className="form-label small">Fax</label><input className="form-control form-control-sm" value={form.fax} onChange={e => setField('fax', e.target.value)} /></div>
            </div>

            {/* Address & Facility */}
            <h6 className="text-uppercase small fw-bold text-primary mb-2"><i className="bi bi-geo-alt me-2"></i>Address & Facility</h6>
            <div className="row g-2 mb-3">
              <div className="col-md-6"><label className="form-label small fw-semibold">Street</label><input className="form-control form-control-sm" value={form.street} onChange={e => setField('street', e.target.value)} /></div>
              <div className="col-md-6"><label className="form-label small">City</label><CitySelect value={form.city} onChange={v => setField('city', v)} /></div>
              <div className="col-md-4">
                <label className="form-label small fw-semibold">Primary Facility</label>
                <select className="form-select form-select-sm" value={form.facility_id} onChange={e => setField('facility_id', e.target.value)}>
                  <option value="">— None —</option>
                  {facilities.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div className="col-md-4"><label className="form-label small">Organization</label><input className="form-control form-control-sm" value={form.organization} onChange={e => setField('organization', e.target.value)} /></div>
              <div className="col-md-4"><label className="form-label small">Assistant</label><input className="form-control form-control-sm" value={form.assistant} onChange={e => setField('assistant', e.target.value)} /></div>
            </div>

            <div className="d-flex gap-2 pt-3 border-top">
              <button className="btn btn-primary rounded-pill px-4"
                onClick={() => editProvider ? updateProvider.mutate(form) : createProvider.mutate(form)}
                disabled={createProvider.isPending || updateProvider.isPending || !form.username || !form.fname || !form.lname}>
                {createProvider.isPending || updateProvider.isPending ? (
                  <><span className="spinner-border spinner-border-sm me-1"></span>Saving...</>
                ) : (<><i className={`bi ${editProvider ? 'bi-check-lg' : 'bi-plus-lg'} me-1`}></i>{editProvider ? 'Update Provider' : 'Add Provider'}</>)}
              </button>
              <button className="btn btn-outline-secondary rounded-pill" onClick={resetForm}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
