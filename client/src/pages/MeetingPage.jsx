import { useState } from 'react';
import { useParams } from 'react-router';
import { StatusMessage } from '../components/StatusMessage.jsx';
import { useMeeting } from '../hooks/useMeeting.js';
import { getHostKey } from '../lib/hostKeys.js';
import { isValidMeetingCode } from '../lib/meetingCode.js';

export function MeetingPage() {
  const { code } = useParams();

  if (!isValidMeetingCode(code)) {
    return (
      <StatusMessage title="Invalid meeting link">
        “{code}” isn’t a valid meeting code. Check the link and try again.
      </StatusMessage>
    );
  }

  return <MeetingLobby code={code} />;
}

function MeetingLobby({ code }) {
  const { status, meeting, error } = useMeeting(code);

  if (status === 'loading') {
    return (
      <section className="card status-message" aria-busy="true">
        <p className="muted">Loading meeting…</p>
      </section>
    );
  }

  if (status === 'error') {
    if (error.code === 'NOT_FOUND') {
      return (
        <StatusMessage title="Meeting not found">
          This meeting doesn’t exist. Double-check the code or ask the host for a new link.
        </StatusMessage>
      );
    }
    return <StatusMessage title="Something went wrong">{error.message}</StatusMessage>;
  }

  if (meeting.status === 'ended') {
    return <StatusMessage title="This meeting has ended">Ask the host to start a new one.</StatusMessage>;
  }

  const isHost = Boolean(getHostKey(code));
  const inviteUrl = `${window.location.origin}/m/${meeting.code}`;

  return (
    <div className="lobby">
      {/* Camera/mic preview arrives in the next milestone. */}
      <section className="card preview-placeholder" aria-label="Camera preview">
        <p className="muted">Camera preview coming soon</p>
      </section>

      <section className="card stack">
        <div className="lobby-heading">
          <h1>{meeting.title || 'Untitled meeting'}</h1>
          {isHost && <span className="badge">Host</span>}
        </div>
        <p className="muted">
          Code <code>{meeting.code}</code> · up to {meeting.maxParticipants} people
        </p>

        <CopyLink url={inviteUrl} />

        <button type="button" className="btn btn-primary" disabled title="Available in the next milestone">
          Join meeting
        </button>
      </section>
    </div>
  );
}

function CopyLink({ url }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the link is still visible to select manually.
    }
  }

  return (
    <div className="field">
      <label htmlFor="invite">Invite link</label>
      <div className="copy-row">
        <input id="invite" className="input" value={url} readOnly onFocus={(e) => e.target.select()} />
        <button type="button" className="btn btn-secondary" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
