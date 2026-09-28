import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';
import AvatarUpload from '../../components/common/AvatarUpload';

export default function ProviderProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: provider, isLoading } = useQuery({
    queryKey: ['provider-profile', id],
    queryFn: async () => {
      const r = await nestClient.get(`/provider/profile/${id}`);
      return r.data;
    },
    enabled: !!id,
  });

  const { data: avatarData } = useQuery({
    queryKey: ['provider-avatar', id],
    queryFn: async () => {
      const r = await nestClient.get(`/avatars/${id}`);
      return r.data;
    },
    enabled: !!id,
  });

  // Avatars belong to users and the SPA is not told its own user id at login, so
  // ask the API who "me" is. Only your own profile may be changed — the upload
  // endpoint writes the caller's avatar regardless of the id in the URL.
  const { data: myAvatar } = useQuery({
    queryKey: ['avatar', 'me'],
    queryFn: async () => {
      try {
        const r = await nestClient.get('/avatars/me');
        return r.data;
      } catch {
        return null;
      }
    },
  });
  const isMyProfile = !!id && Number(id) === Number(myAvatar?.userId);
  // Administrators (and front desk with provider-edit rights) may set another
  // user's photo; the API re-checks, this only decides what to offer.
  const canEditThisAvatar = isMyProfile || !!myAvatar?.canManageOthers;

  if (isLoading) {
    return (
      <div className="text-center py-5">
        <div className="spinner-border text-primary" />
        <p className="text-muted mt-2">Loading profile...</p>
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="text-center py-5">
        <i className="bi bi-person-x fs-1 text-muted"></i>
        <h5 className="mt-2">Provider not found</h5>
        <button className="btn btn-outline-primary mt-2 rounded-pill" onClick={() => navigate('/providers')}>
          <i className="bi bi-arrow-left me-1"></i>Back to Providers
        </button>
      </div>
    );
  }

  const initials = `${provider.fname?.[0] || ''}${provider.lname?.[0] || ''}`;
  const avatarUrl = avatarData?.url;
  const hasSchedule = provider.todayAvailability?.length > 0;

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="mb-3 small">
        <a href="#" className="text-decoration-none text-muted" onClick={e => { e.preventDefault(); navigate('/providers'); }}>
          <i className="bi bi-people me-1"></i>Providers
        </a>
        <span className="text-muted mx-1">/</span>
        <span className="fw-semibold">{provider.title ? `${provider.title} ` : ''}{provider.fname} {provider.lname}</span>
      </nav>

      {/* Profile Header */}
      <div className="rounded-4 p-4 mb-4 text-white position-relative overflow-hidden" style={{
        background: `linear-gradient(135deg, ${provider.calendar_color || '#0d6efd'} 0%, ${provider.calendar_color ? provider.calendar_color + '99' : '#0d6efd99'} 60%, #212529 100%)`,
      }}>
        <div className="position-absolute end-0 top-0 opacity-10" style={{ fontSize: '8rem', transform: 'rotate(15deg) translate(20px,-20px)' }}>
          <i className="bi bi-person-badge"></i>
        </div>
        <div className="position-relative">
          <div className="d-flex align-items-start gap-4 flex-wrap">
            {/* Avatar — editable on your own profile, or by a user manager */}
            <div className="flex-shrink-0">
              {canEditThisAvatar ? (
                <div className="bg-white bg-opacity-25 rounded-circle p-1">
                  <AvatarUpload
                    userId={Number(id)}
                    currentAvatarUrl={avatarUrl}
                    size={96}
                    onAvatarChanged={() => queryClient.invalidateQueries({ queryKey: ['provider-avatar', id] })}
                  />
                  {!isMyProfile && (
                    <div className="text-center text-white-50 mt-1" style={{ fontSize: '0.65rem' }}>
                      Editing another user's photo
                    </div>
                  )}
                </div>
              ) : avatarUrl ? (
                <img src={avatarUrl} alt="" className="rounded-circle shadow"
                  style={{ width: '96px', height: '96px', objectFit: 'cover', border: '3px solid rgba(255,255,255,0.4)' }} />
              ) : (
                <div className="rounded-circle d-flex align-items-center justify-content-center fw-bold shadow"
                  style={{
                    width: '96px', height: '96px', fontSize: '2.2rem',
                    background: 'rgba(255,255,255,0.2)',
                    border: '3px solid rgba(255,255,255,0.4)',
                  }}>
                  {initials}
                </div>
              )}
            </div>

            <div className="flex-grow-1">
              <h3 className="mb-1 fw-bold">
                {provider.title ? `${provider.title} ` : ''}{provider.fname} {provider.mname ? `${provider.mname} ` : ''}{provider.lname}
                {provider.suffix && <small className="opacity-75">, {provider.suffix}</small>}
              </h3>
              <div className="d-flex flex-wrap gap-1 mb-2">
                {provider.specialty && (
                  <span className="badge bg-white bg-opacity-25">{provider.specialty}</span>
                )}
                {provider.physician_type && (
                  <span className="badge bg-white bg-opacity-25">{provider.physician_type.replace(/_/g, ' ')}</span>
                )}
                <span className={`badge ${provider.active ? 'bg-success' : 'bg-danger'} bg-opacity-90`}>
                  <i className={`bi ${provider.active ? 'bi-check-circle' : 'bi-x-circle'} me-1`}></i>
                  {provider.active ? 'Active' : 'Inactive'}
                </span>
              </div>

              {/* Quick info pills */}
              <div className="d-flex flex-wrap gap-2">
                {provider.npi && (
                  <span className="badge bg-white bg-opacity-15 rounded-pill px-3 py-2">
                    <i className="bi bi-upc me-1 opacity-75"></i>NPI: {provider.npi}
                  </span>
                )}
                {provider.taxonomy && (
                  <span className="badge bg-white bg-opacity-15 rounded-pill px-3 py-2">
                    <i className="bi bi-tag me-1 opacity-75"></i>{provider.taxonomy}
                  </span>
                )}
                {provider.state_license_number && (
                  <span className="badge bg-white bg-opacity-15 rounded-pill px-3 py-2">
                    <i className="bi bi-shield-check me-1 opacity-75"></i>License: {provider.state_license_number}
                  </span>
                )}
                {provider.upin && (
                  <span className="badge bg-white bg-opacity-15 rounded-pill px-3 py-2">
                    <i className="bi bi-hash me-1 opacity-75"></i>UPIN: {provider.upin}
                  </span>
                )}
              </div>
            </div>

            <div className="ms-auto d-flex gap-2">
              <button className="btn btn-light rounded-pill" onClick={() => navigate(`/providers`)}>
                <i className="bi bi-pencil me-1"></i>Edit
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Today's Status Bar */}
      <div className="row g-3 mb-4">
        <div className="col-md-4">
          <div className={`card border-0 shadow-sm h-100 ${hasSchedule ? 'bg-success bg-opacity-10' : 'bg-light'}`} style={{ borderRadius: '16px' }}>
            <div className="card-body d-flex align-items-center gap-3 py-3">
              <div className={`rounded-circle d-flex align-items-center justify-content-center flex-shrink-0`}
                style={{ width: '48px', height: '48px', backgroundColor: hasSchedule ? 'rgba(25,135,84,0.15)' : 'rgba(108,117,125,0.1)' }}>
                <i className={`bi bi-clock fs-5 ${hasSchedule ? 'text-success' : 'text-muted'}`}></i>
              </div>
              <div>
                <div className="fw-bold">{hasSchedule ? 'In Office Today' : 'Not Scheduled Today'}</div>
                <small className="text-muted">
                  {hasSchedule
                    ? provider.todayAvailability.map((s: any) => `${s.pc_startTime?.substring(0, 5)}–${s.pc_endTime?.substring(0, 5)}`).join(', ')
                    : 'No in-office hours set'}
                </small>
              </div>
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
            <div className="card-body d-flex align-items-center gap-3 py-3">
              <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                style={{ width: '48px', height: '48px', backgroundColor: 'rgba(13,110,253,0.08)' }}>
                <i className="bi bi-envelope fs-5 text-primary"></i>
              </div>
              <div>
                <div className="fw-bold">{provider.email || 'No email on file'}</div>
                <small className="text-muted">
                  {provider.email_direct && <span>Direct: {provider.email_direct}</span>}
                  {!provider.email_direct && 'Direct messaging not configured'}
                </small>
              </div>
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '16px' }}>
            <div className="card-body d-flex align-items-center gap-3 py-3">
              <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                style={{ width: '48px', height: '48px', backgroundColor: 'rgba(111,66,193,0.08)' }}>
                <i className="bi bi-building fs-5" style={{ color: '#6f42c1' }}></i>
              </div>
              <div>
                <div className="fw-bold">{provider.organization || 'No Organization'}</div>
                <small className="text-muted">
                  {provider.street ? provider.city || '' : 'No address on file'}
                </small>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Detail Cards */}
      <div className="row g-3">
        {/* Contact */}
        <div className="col-lg-6">
          <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '20px' }}>
            <div className="card-header bg-white py-3" style={{ borderRadius: '20px 20px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-telephone me-2 text-primary"></i>Contact Information</h6>
            </div>
            <div className="card-body">
              {provider.email || provider.phone || provider.phonecell || provider.fax ? (
                <div className="row g-3">
                  {provider.email && (
                    <div className="col-sm-6">
                      <div className="p-3 bg-light rounded-3">
                        <small className="text-muted d-block text-uppercase">Email</small>
                        <a href={`mailto:${provider.email}`} className="fw-semibold text-decoration-none small">{provider.email}</a>
                      </div>
                    </div>
                  )}
                  {provider.email_direct && (
                    <div className="col-sm-6">
                      <div className="p-3 bg-light rounded-3">
                        <small className="text-muted d-block text-uppercase">Direct (HISP)</small>
                        <code className="small">{provider.email_direct}</code>
                      </div>
                    </div>
                  )}
                  {provider.phone && (
                    <div className="col-sm-6">
                      <div className="p-3 bg-light rounded-3">
                        <small className="text-muted d-block text-uppercase">Phone</small>
                        <a href={`tel:${provider.phone}`} className="fw-bold text-decoration-none">{provider.phone}</a>
                      </div>
                    </div>
                  )}
                  {provider.phonecell && (
                    <div className="col-sm-6">
                      <div className="p-3 bg-light rounded-3">
                        <small className="text-muted d-block text-uppercase">Cell</small>
                        <a href={`tel:${provider.phonecell}`} className="fw-bold text-decoration-none">{provider.phonecell}</a>
                      </div>
                    </div>
                  )}
                  {provider.phonew1 && (
                    <div className="col-sm-6">
                      <div className="p-3 bg-light rounded-3">
                        <small className="text-muted d-block text-uppercase">Work</small>
                        <span className="fw-semibold small">{provider.phonew1}</span>
                      </div>
                    </div>
                  )}
                  {provider.fax && (
                    <div className="col-sm-6">
                      <div className="p-3 bg-light rounded-3">
                        <small className="text-muted d-block text-uppercase">Fax</small>
                        <span className="fw-semibold small">{provider.fax}</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-muted text-center py-2 mb-0">No contact information on file</p>
              )}
            </div>
          </div>
        </div>

        {/* Address & Organization */}
        <div className="col-lg-6">
          <div className="card border-0 shadow-sm h-100" style={{ borderRadius: '20px' }}>
            <div className="card-header bg-white py-3" style={{ borderRadius: '20px 20px 0 0' }}>
              <h6 className="mb-0 fw-bold"><i className="bi bi-geo-alt me-2 text-success"></i>Address & Organization</h6>
            </div>
            <div className="card-body">
              {provider.street ? (
                <div className="mb-3">
                  <div className="p-3 bg-light rounded-3">
                    <i className="bi bi-geo-alt-fill text-success me-1"></i>
                    <span className="small">{provider.street}</span><br />
                    <span className="small fw-semibold">{provider.city || '—'}</span>
                  </div>
                </div>
              ) : (
                <p className="text-muted small mb-3">No address on file</p>
              )}
              {provider.organization && (
                <div className="p-3 bg-light rounded-3 mb-2">
                  <small className="text-muted d-block text-uppercase">Organization</small>
                  <span className="fw-semibold small">{provider.organization}</span>
                </div>
              )}
              {provider.federaldrugid && (
                <div className="p-3 bg-light rounded-3 mb-2">
                  <small className="text-muted d-block text-uppercase">Federal Drug ID</small>
                  <code className="small">{provider.federaldrugid}</code>
                </div>
              )}
              {provider.assistant && (
                <div className="p-3 bg-light rounded-3">
                  <small className="text-muted d-block text-uppercase">Assistant</small>
                  <span className="fw-semibold small">{provider.assistant}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
