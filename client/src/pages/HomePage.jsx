import { useState } from 'react';
import { useNavigate } from 'react-router';
import { createMeeting } from '../api/meetings.js';
import { saveHostKey } from '../lib/storage.js';
import { MEETING_TITLE_MAX, parseMeetingInput } from '../lib/meetingCode.js';

export function HomePage() {
  return (
    <>
      <section className="hero">
        <h1>Video meetings, right in your browser.</h1>
        <p className="muted">Start a meeting, share the link, and talk — no installs, no sign-up.</p>
      </section>

      <div className="grid-2">
        <CreateMeetingCard />
        <JoinMeetingCard />
      </div>
    </>
  );
}

function CreateMeetingCard() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { meeting, hostKey } = await createMeeting({ title: title.trim() });
      saveHostKey(meeting.code, hostKey);
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
