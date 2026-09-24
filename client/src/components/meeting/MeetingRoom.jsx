import { useEffect, useState } from 'react';
import { endMeeting } from '../../api/meetings.js';
import { useMeetingRoom } from '../../hooks/useMeetingRoom.js';
import { CopyLink } from '../CopyLink.jsx';
import { LeaveIcon } from '../icons.jsx';
import { MediaControls } from '../MediaControls.jsx';
import { StatusMessage } from '../StatusMessage.jsx';
import { VideoTile } from '../VideoTile.jsx';

/**
 * In-meeting view. Presence is live (who joined/left); remote video arrives
 * with WebRTC in the next milestone, so other people show as avatars for now.
 */
export function MeetingRoom({ meeting, session, media, onExit }) {
  const room = useMeetingRoom(session.token);
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
          micMuted={!media.micOn}
          badge={isHost ? 'Host' : undefined}
          isLocal
        />
        {room.peers.map((peer) => (
          <VideoTile
            key={peer.participantId}
            name={peer.displayName}
            hasVideo={false}
            badge={peer.role === 'host' ? 'Host' : undefined}
          />
        ))}
      </section>

      {room.peers.length === 0 && room.status === 'joined' && (
        <div className="card invite-card">
          <p className="muted">You’re the only one here. Share the link to invite others.</p>
          <CopyLink url={`${window.location.origin}/m/${meeting.code}`} />
        </div>
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
