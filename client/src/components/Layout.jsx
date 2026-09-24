import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';

export function Layout() {
  const auth = useAuth();
  const location = useLocation();
  const here = encodeURIComponent(location.pathname);

  return (
    <div className="app-shell">
      <header className="header">
        <div className="container header-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true" />
            Confer
          </Link>

          <nav className="nav" aria-label="Account">
            {auth.status === 'signedIn' && (
              <>
                <NavLink to="/meetings" className="nav-link">
                  My meetings
                </NavLink>
                <span className="nav-user" title={auth.user.email}>
                  {auth.user.name}
                </span>
                <button type="button" className="btn btn-secondary btn-small" onClick={auth.signOut}>
                  Sign out
                </button>
              </>
            )}
            {auth.status === 'signedOut' && (
              <>
                <Link to={`/login?next=${here}`} className="nav-link">
                  Sign in
                </Link>
                <Link to={`/signup?next=${here}`} className="btn btn-primary btn-small">
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="container main">
        <Outlet />
      </main>

      <footer className="footer container">Built with React, Express, MongoDB &amp; WebRTC</footer>
    </div>
  );
}
