import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { getMeetingHistory } from '../api/meetings.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Meetings the signed-in user hosted or attended. */
export function HistoryPage() {
  useDocumentTitle('My meetings');
  const auth = useAuth();
  const [state, setState] = useState({ status: 'loading', meetings: [], error: null });

  useEffect(() => {
    if (auth.status !== 'signedIn') return;
    const controller = new AbortController();
    getMeetingHistory({ signal: controller.signal })
      .then(({ meetings }) => setState({ status: 'success', meetings, error: null }))
      .catch((error) => {
        if (error.name !== 'AbortError') setState({ status: 'error', meetings: [], error });
      });
    return () => controller.abort();
  }, [auth.status]);

  if (auth.status === 'loading') return <p className="muted">Loading…</p>;
  if (auth.status === 'signedOut') return <Navigate to="/login?next=%2Fmeetings" replace />;

  return (
    <section className="stack">
      <div className="page-heading">
        <h1>My meetings</h1>
        <Link to="/" className="btn btn-primary">
          New meeting
        </Link>
      </div>

      {state.status === 'loading' && <p className="muted">Loading your meetings…</p>}
      {state.status === 'error' && (
        <p className="alert" role="alert">
          {state.error.message}
        </p>
      )}
      {state.status === 'success' && state.meetings.length === 0 && (
        <div className="card status-message">
          <h2>No meetings yet</h2>
          <p className="muted">Meetings you host or join while signed in show up here.</p>
          <Link to="/" className="btn btn-primary">
            Start a meeting
          </Link>
        </div>
      )}

      {state.meetings.length > 0 && (
        <ul className="history-list">
          {state.meetings.map((m) => (
            <li key={m.code} className="card history-item">
              <div className="history-main">
                <h2>{m.title || 'Untitled meeting'}</h2>
                <p className="muted">
                  <time dateTime={m.createdAt}>{dateFormat.format(new Date(m.createdAt))}</time> · <code>{m.code}</code> ·{' '}
                  {m.attendeeCount} {m.attendeeCount === 1 ? 'attendee' : 'attendees'}
                </p>
              </div>
              <div className="history-meta">
                <span className="badge">{m.role === 'host' ? 'Host' : 'Attended'}</span>
                <span className={`status-pill ${m.status}`}>{m.status === 'active' ? 'Active' : 'Ended'}</span>
                {m.status === 'active' && (
                  <Link to={`/m/${m.code}`} className="btn btn-secondary btn-small">
                    Open
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
