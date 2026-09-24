import { useState } from 'react';
import { Link } from 'react-router';
import { joinMeeting } from '../../api/meetings.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DISPLAY_NAME_MAX } from '../../lib/meetingCode.js';
import { getSavedDisplayName, saveDisplayName } from '../../lib/storage.js';
import { CopyLink } from '../CopyLink.jsx';
import { MediaControls } from '../MediaControls.jsx';
import { MicLevel } from '../MicLevel.jsx';
import { VideoTile } from '../VideoTile.jsx';

// Join errors that mean "you can't join this way" rather than "try again".
const BLOCKING_ERRORS = new Set(['SIGN_IN_REQUIRED', 'MEETING_LOCKED', 'REMOVED_FROM_MEETING']);

/**
 * Lobby: camera/mic preview, device pickers, display name, then join.
 * The hints here (sign-in required, locked, waiting room) are for a good UX
 * only; the server enforces every one of them on join.
 */
export function PreJoin({ meeting, media, onJoined, onMeetingEnded }) {
  const auth = useAuth();
  const signedIn = auth.status === 'signedIn';
  const isHost = meeting.viewerIsHost;
  // Signed in: your account name. Guest: the name you used last time on this device.
  const [displayName, setDisplayName] = useState(() => auth.user?.name || getSavedDisplayName());
  const [nameError, setNameError] = useState(null);
  const [joinError, setJoinError] = useState(null);
  const [joining, setJoining] = useState(false);

  const signInLink = `/login?next=${encodeURIComponent(`/m/${meeting.code}`)}`;
  const needsSignIn = !isHost && !signedIn && !meeting.settings.allowGuests;
  const locked = !isHost && meeting.settings.locked;
  const willWait = !isHost && meeting.settings.waitingRoom;
  const isFull = meeting.participantCount >= meeting.maxParticipants;
  const blocked = needsSignIn || locked || BLOCKING_ERRORS.has(joinError?.code);

  async function handleJoin(event) {
    event.preventDefault();
    const name = displayName.trim();
    if (!name) {
      setNameError('Enter your name so others know who you are.');
      return;
    }

    setJoining(true);
    setJoinError(null);
    try {
      const session = await joinMeeting(meeting.code, { displayName: name });
      saveDisplayName(name);
      onJoined(session);
    } catch (err) {
      setJoining(false);
      if (err.code === 'MEETING_ENDED') return onMeetingEnded(err.message);
      const nameIssue = err.details?.find((d) => d.path === 'displayName');
      if (nameIssue) setNameError(nameIssue.message);
      else setJoinError(err);
    }
  }

  return (
    <div className="lobby">
      <section className="stack" aria-label="Camera and microphone preview">
        <DevicePreview media={media} name={displayName.trim() || 'You'} />

        <div className="preview-toolbar">
          <MediaControls media={media} />
          <MicLevel track={media.audioTrack} active={media.micOn} />
        </div>

        {media.status !== 'unsupported' && <DevicePickers media={media} />}
      </section>

      <form className="card stack" onSubmit={handleJoin} noValidate>
        <div className="lobby-heading">
          <h1>{meeting.title || 'Untitled meeting'}</h1>
          {isHost && <span className="badge">You’re the host</span>}
        </div>
        <p className="muted">
          Hosted by {isHost ? 'you' : meeting.hostName} ·{' '}
          {meeting.participantCount === 0
            ? 'no one is here yet'
            : `${meeting.participantCount} of ${meeting.maxParticipants} people inside`}
        </p>

        {needsSignIn || joinError?.code === 'SIGN_IN_REQUIRED' ? (
          <div className="notice">
            <p>
              <strong>Sign in to join.</strong> The host only allows people with an account.
            </p>
            <Link to={signInLink} className="btn btn-primary">
              Sign in
            </Link>
          </div>
        ) : locked || joinError?.code === 'MEETING_LOCKED' ? (
          <p className="notice" role="status">
            <strong>This meeting is locked.</strong> The host isn’t letting anyone new in right now.
          </p>
        ) : joinError?.code === 'REMOVED_FROM_MEETING' ? (
          <p className="notice" role="status">
            <strong>You were removed from this meeting</strong> and can’t rejoin it.
          </p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="displayName">Your name</label>
              <input
                id="displayName"
                className="input"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  if (nameError) setNameError(null);
                }}
                maxLength={DISPLAY_NAME_MAX}
                placeholder="e.g. Ada Lovelace"
                autoComplete="name"
                autoFocus={!displayName}
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? 'name-error' : undefined}
              />
              {nameError && (
                <p id="name-error" className="error-text" role="alert">
                  {nameError}
                </p>
              )}
            </div>

            {!signedIn && (
              <p className="muted small">
                Joining as a guest. <Link to={signInLink}>Sign in</Link> to keep this meeting in your history.
              </p>
            )}
            {willWait && <p className="muted small">The host will let you in from the waiting room.</p>}
            {joinError && (
              <p className="alert" role="alert">
                {joinError.message}
              </p>
            )}
            {isFull && !joinError && <p className="alert">This meeting is full right now.</p>}
          </>
        )}

        <button type="submit" className="btn btn-primary" disabled={joining || blocked}>
          {joining ? 'Joining…' : willWait ? 'Ask to join' : 'Join meeting'}
        </button>

        <CopyLink url={`${window.location.origin}/m/${meeting.code}`} />
      </form>
    </div>
  );
}

function DevicePreview({ media, name }) {
  const { status, stream, videoTrack, camOn, micOn, errors, retry } = media;

  let overlay = null;
  if (status === 'unsupported') {
    overlay = (
      <p>
        Your browser can’t access a camera or microphone here. Use a recent Chrome, Edge or Firefox, and open the
        app over <strong>https://</strong> (or localhost).
      </p>
    );
  } else if (status === 'requesting' || status === 'idle') {
    overlay = <p>Waiting for camera and microphone permission…</p>;
  } else if (errors.video || errors.audio) {
    overlay = (
      <>
        {errors.video && camOn && <p>{errors.video.message}</p>}
        {errors.audio && <p>{errors.audio.message}</p>}
        {(errors.video && camOn) || errors.audio ? (
          <button type="button" className="btn btn-secondary btn-small" onClick={retry}>
            Try again
          </button>
        ) : null}
      </>
    );
  }

  return (
    <VideoTile
      stream={stream}
      hasVideo={Boolean(videoTrack)}
      name={name}
      label={camOn ? name : `${name} · camera off`}
      micMuted={!micOn}
      isLocal
    >
      {overlay && (
        <div className="tile-overlay" role="status">
          {overlay}
        </div>
      )}
    </VideoTile>
  );
}

function DevicePickers({ media }) {
  const { devices, selected, selectDevice } = media;

  return (
    <div className="grid-2 device-pickers">
      <DeviceSelect
        id="camera-select"
        label="Camera"
        options={devices.video}
        value={selected.video}
        onChange={(id) => selectDevice('video', id)}
      />
      <DeviceSelect
        id="mic-select"
        label="Microphone"
        options={devices.audio}
        value={selected.audio}
        onChange={(id) => selectDevice('audio', id)}
      />
    </div>
  );
}

function DeviceSelect({ id, label, options, value, onChange }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={options.length === 0}
      >
        {options.length === 0 && <option value="">Not available</option>}
        {options.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </select>
    </div>
  );
}
