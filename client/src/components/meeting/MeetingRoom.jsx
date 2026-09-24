import { useEffect, useMemo, useState } from 'react';
import { endMeeting } from '../../api/meetings.js';
import { useMeetingRoom } from '../../hooks/useMeetingRoom.js';
import { CopyLink } from '../CopyLink.jsx';
import { LeaveIcon } from '../icons.jsx';
import { MediaControls } from '../MediaControls.jsx';
import { RemoteAudio } from '../RemoteAudio.jsx';
import { StatusMessage } from '../StatusMessage.jsx';
import { VideoTile } from '../VideoTile.jsx';

/** In-meeting view: video grid, per-person connection status, controls. */
export function MeetingRoom({ meeting, session, media, onExit }) {
  // What we tell others: "mic on" only if there is a live, enabled track.
  const mediaState = useMemo(
    () => ({ audio: media.micOn && Boolean(media.audioTrack), video: Boolean(media.videoTrack) }),
    [media.micOn, media.audioTrack, media.videoTrack],
  );

  const room = useMeetingRoom({
    token: session.token,
    rtcConfig: session.rtcConfig,
    audioTrack: media.audioTrack,
    videoTrack: media.videoTrack,
    mediaState,
  });
  const [ending, setEnding] = useState(false);
  const [actionError, setActionError] = useState(null);
  const isHost = session.participant.role === 'host';

  // Server-driven exits: host ended the meeting, or we joined from another tab.
  useEffect(() => {
    if (room.status === 'ended') {
      if (room.endedReason === 'expired') onExit('expired');
      else onExit(isHost ? 'you_ended' : 'host_ended');
    }
    if (room.status === 'replaced') onExit('replaced');
  }, [room.status, room.endedReason, isHost, onExit]);

  async function handleLeave() {
    await room.leave();
    onExit('left');
  }

  async function handleEndForAll() {
    if (!window.confirm('End the meeting for everyone?')) return;
    setEnding(true);
    setActionError(null);
    try {
      await endMeeting(meeting.code, session.token);
      // The server now broadcasts meeting:ended, which triggers onExit above.
    } catch (err) {
      setActionError(err.message);
      setEnding(false);
    }
  }

  if (room.status === 'error') {
    return (
      <StatusMessage
        title={room.error?.code === 'ROOM_FULL' ? 'This meeting is full' : 'Couldn’t join the meeting'}
        action={{ to: `/m/${meeting.code}`, label: 'Back to lobby', reloadDocument: true }}
      >
        {room.error?.message}
      </StatusMessage>
    );
  }

  const count = room.peers.length + 1;
  const deviceProblem = media.errors.video?.message ?? media.errors.audio?.message;

  return (
    <div className="room">
      <header className="room-header">
        <div>
          <h1>{meeting.title || 'Untitled meeting'}</h1>
          <p className="muted">
            <code>{meeting.code}</code> · {count} {count === 1 ? 'person' : 'people'}
          </p>
        </div>
        {room.status !== 'joined' && (
          <p className="banner" role="status">
            {room.status === 'connecting' ? 'Connecting…' : 'Connection lost. Reconnecting…'}
          </p>
        )}
      </header>

      <section className="tile-grid" data-count={count} aria-label="Participants">
        <VideoTile
          stream={media.stream}
          hasVideo={Boolean(media.videoTrack)}
          name={session.participant.displayName}
          label={`${session.participant.displayName} (you)`}
          micMuted={!mediaState.audio}
          badge={isHost ? 'Host' : undefined}
          isLocal
        />
        {room.peers.map((peer) => (
          <VideoTile
            key={peer.participantId}
            stream={peer.stream}
            hasVideo={Boolean(peer.stream && peer.media?.video)}
            name={peer.displayName}
            micMuted={!peer.media?.audio}
            badge={peer.role === 'host' ? 'Host' : undefined}
            connectionState={peer.connectionState}
          />
        ))}
      </section>

      {room.peers.map((peer) => peer.stream && <RemoteAudio key={peer.participantId} stream={peer.stream} />)}

      {room.peers.length === 0 && room.status === 'joined' && (
        <div className="card invite-card">
          <p className="muted">You’re the only one here. Share the link to invite others.</p>
          <CopyLink url={`${window.location.origin}/m/${meeting.code}`} />
        </div>
      )}

      {deviceProblem && (
        <p className="alert" role="status">
          {deviceProblem}{' '}
          <button type="button" className="link-button" onClick={media.retry}>
            Try again
          </button>
        </p>
      )}

      {actionError && (
        <p className="alert" role="alert">
          {actionError}
        </p>
      )}

      <footer className="control-bar" aria-label="Meeting controls">
        <MediaControls media={media} />
        <button type="button" className="control control-danger" onClick={handleLeave} title="Leave meeting">
          <LeaveIcon />
          <span>Leave</span>
        </button>
        {isHost && (
          <button type="button" className="btn btn-danger-outline" onClick={handleEndForAll} disabled={ending}>
            {ending ? 'Ending…' : 'End for all'}
          </button>
        )}
      </footer>
    </div>
  );
}
