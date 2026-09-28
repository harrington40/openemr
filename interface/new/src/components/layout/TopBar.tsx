import { NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useMyAvatar } from '../../hooks/useMyAvatar';

export default function TopBar() {
  const { user, logout } = useAuth();
  const { data: myAvatar } = useMyAvatar();
  const myAvatarUrl = myAvatar?.url || undefined;
  // /provider/profile/:id only accepts these roles, so only they get a link.
  const canOpenProfile =
    !!myAvatar?.userId && !!user?.role && ['admin', 'physician', 'front_desk'].includes(user.role);

  const avatar = myAvatarUrl ? (
    <img
      src={myAvatarUrl}
      alt=""
      className="rounded-circle flex-shrink-0"
      style={{ width: '1.75rem', height: '1.75rem', objectFit: 'cover' }}
    />
  ) : (
    <i className="bi bi-person-circle" style={{ fontSize: '1.4rem', color: '#6c757d' }}></i>
  );

  return (
    <header className="bg-white border-bottom px-3 py-2 d-flex justify-content-between align-items-center">
      <div>
        {/* Breadcrumb or page title — filled by child routes via Outlet context */}
      </div>
      <div className="d-flex align-items-center gap-3">
        {user && (
          canOpenProfile ? (
            <NavLink
              to={`/providers/${myAvatar!.userId}`}
              className="d-flex align-items-center gap-2 text-decoration-none"
              title={myAvatarUrl ? 'My profile & photo' : 'Add your photo'}
            >
              {avatar}
              <span className="text-muted small">{user.displayName}</span>
            </NavLink>
          ) : (
            <span className="text-muted small d-flex align-items-center gap-2">
              {avatar}
              {user.displayName}
            </span>
          )
        )}
        <button className="btn btn-outline-secondary btn-sm" onClick={logout}>
          <i className="bi bi-box-arrow-right me-1"></i>
          Logout
        </button>
      </div>
    </header>
  );
}
