import { Link } from 'react-router';

// Full-card message for empty/error states (not found, ended, offline, ...).
export function StatusMessage({ title, children, action = { to: '/', label: 'Back to home' }, secondary }) {
  return (
    <section className="card status-message">
      <h1>{title}</h1>
      {children && <p className="muted">{children}</p>}
      <div className="status-actions">
        {action && (
          <Link to={action.to} className="btn btn-primary" reloadDocument={action.reloadDocument}>
            {action.label}
          </Link>
        )}
        {secondary && (
          <Link to={secondary.to} className="btn btn-secondary">
            {secondary.label}
          </Link>
        )}
      </div>
    </section>
  );
}
