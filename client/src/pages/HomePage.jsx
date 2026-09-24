import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { createMeeting } from '../api/meetings.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { MEETING_TITLE_MAX, parseMeetingInput } from '../lib/meetingCode.js';

export function HomePage() {
  return (
    <>
      <section className="hero">
        <h1>Video meetings, right in your browser.</h1>
        <p className="muted">Start a meeting, share the link, and talk — no installs.</p>
      </section>

      <div className="grid-2">
        <CreateMeetingCard />
        <JoinMeetingCard />
      </div>
    </>
  );
}

function CreateMeetingCard() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [allowGuests, setAllowGuests] = useState(true);
  const [waitingRoom, setWaitingRoom] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (auth.status !== 'signedIn') {
    return (
      <section className="card stack">
        <h2>New meeting</h2>
        <p className="muted">Sign in to host meetings. Anyone with the link can join — you decide whether they need an account.</p>
        <div className="row">
          <Link to="/login" className="btn btn-primary">
            Sign in
          </Link>
          <Link to="/signup" className="btn btn-secondary">
            Create account
          </Link>
        </div>
      </section>
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { meeting } = await createMeeting({ title: title.trim(), settings: { allowGuests, waitingRoom } });
      navigate(`/m/${meeting.code}`);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <form className="card stack" onSubmit={handleSubmit} noValidate>
      <h2>New meeting</h2>
      <div className="field">
        <label htmlFor="title">Title (optional)</label>
        <input
          id="title"
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={MEETING_TITLE_MAX}
          placeholder="Weekly sync"
          autoComplete="off"
        />
      </div>
      <fieldset className="checks">
        <legend className="sr-only">Meeting options</legend>
        <label className="check">
          <input type="checkbox" checked={allowGuests} onChange={(e) => setAllowGuests(e.target.checked)} />
          <span>
            Allow guests <span className="muted">— people without an account can join</span>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={waitingRoom} onChange={(e) => setWaitingRoom(e.target.checked)} />
          <span>
            Waiting room <span className="muted">— you admit each person</span>
          </span>
        </label>
      </fieldset>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create meeting'}
      </button>
    </form>
  );
}

function JoinMeetingCard() {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);

  function handleSubmit(event) {
    event.preventDefault();
    const code = parseMeetingInput(value);
    if (!code) {
      setError('Enter a meeting code like abc-defg-hij, or paste an invite link.');
      return;
    }
    navigate(`/m/${code}`);
  }

  return (
    <form className="card stack" onSubmit={handleSubmit} noValidate>
      <h2>Join a meeting</h2>
      <div className="field">
        <label htmlFor="code">Meeting code or link</label>
        <input
          id="code"
          className="input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          placeholder="abc-defg-hij"
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'code-error' : undefined}
        />
      </div>
      {error && (
        <p id="code-error" className="error-text" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-secondary" disabled={!value.trim()}>
        Join
      </button>
    </form>
  );
}
