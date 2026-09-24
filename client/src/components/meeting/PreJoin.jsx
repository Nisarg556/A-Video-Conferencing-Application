import { useState } from 'react';
import { joinMeeting } from '../../api/meetings.js';
import { DISPLAY_NAME_MAX } from '../../lib/meetingCode.js';
import { getHostKey, getSavedDisplayName, saveDisplayName } from '../../lib/storage.js';
import { CopyLink } from '../CopyLink.jsx';
import { MediaControls } from '../MediaControls.jsx';
import { MicLevel } from '../MicLevel.jsx';
import { VideoTile } from '../VideoTile.jsx';

/** Lobby: camera/mic preview, device pickers, display name, then join. */
export function PreJoin({ meeting, media, onJoined, onMeetingEnded }) {
  const hostKey = getHostKey(meeting.code);
  const [displayName, setDisplayName] = useState(getSavedDisplayName);
  const [nameError, setNameError] = useState(null);
  const [joinError, setJoinError] = useState(null);
  const [joining, setJoining] = useState(false);

  const isFull = meeting.participantCount >= meeting.maxParticipants;

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
      const session = await joinMeeting(meeting.code, { displayName: name, hostKey });
      saveDisplayName(name);
      onJoined(session);
    } catch (err) {
      setJoining(false);
      if (err.code === 'MEETING_ENDED') return onMeetingEnded(err.message);
      const nameIssue = err.details?.find((d) => d.path === 'displayName');
      if (nameIssue) setNameError(nameIssue.message);
      else setJoinError(err.message);
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
          {hostKey && <span className="badge">Host</span>}
        </div>
        <p className="muted">
          {meeting.participantCount === 0
            ? 'No one else is here yet.'
            : `${meeting.participantCount} of ${meeting.maxParticipants} people are in this meeting.`}
        </p>

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

        {joinError && (
          <p className="alert" role="alert">
            {joinError}
          </p>
        )}
        {isFull && !joinError && <p className="alert">This meeting is full right now.</p>}

        <button type="submit" className="btn btn-primary" disabled={joining}>
          {joining ? 'Joining…' : 'Join meeting'}
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
