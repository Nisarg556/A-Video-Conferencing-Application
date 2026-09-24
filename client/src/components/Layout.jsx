import { Link, Outlet } from 'react-router';

export function Layout() {
  return (
    <div className="app-shell">
      <header className="header">
        <div className="container header-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true" />
            Confer
          </Link>
        </div>
      </header>

      <main className="container main">
        <Outlet />
      </main>

      <footer className="footer container">
        Built with React, Express, MongoDB &amp; WebRTC
      </footer>
    </div>
  );
}
