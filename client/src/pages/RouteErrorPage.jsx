import { Link, useRouteError } from 'react-router';

// Rendered instead of the whole layout when something throws during render.
export function RouteErrorPage() {
  const error = useRouteError();
  console.error(error);

  return (
    <div className="container main">
      <section className="card status-message">
        <h1>Something broke</h1>
        <p className="muted">An unexpected error occurred. Try reloading the page.</p>
        <Link to="/" className="btn btn-secondary" reloadDocument>
          Back to home
        </Link>
      </section>
    </div>
  );
}
