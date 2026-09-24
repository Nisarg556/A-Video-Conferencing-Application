import { Link } from 'react-router';

// Full-card message for empty/error states (not found, ended, offline, ...).
export function StatusMessage({ title, children, action = { to: '/', label: 'Back to home' } }) {
  return (
    <section className="card status-message">
      <h1>{title}</h1>
      {children && <p className="muted">{children}</p>}
      {action && (
        <Link to={action.to} className="btn btn-secondary">
          {action.label}
        </Link>
      )}
    </section>
  );
}
