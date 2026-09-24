import { MediaControls } from '../MediaControls.jsx';
import { VideoTile } from '../VideoTile.jsx';

/**
 * Shown while the host decides. The server keeps this socket out of the
 * meeting room, so nothing from the meeting reaches us until we're admitted.
 */
export function WaitingRoom({ meeting, self, media, onLeave }) {
  return (
    <div className="waiting-room">
      <section className="card stack waiting-card" aria-live="polite">
        <div className="spinner" aria-hidden="true" />
        <h1>Waiting for the host to let you in</h1>
        <p className="muted">
          {meeting.title || 'Untitled meeting'} · hosted by {meeting.hostName}. You’ll join automatically once you’re
          admitted.
        </p>
        <button type="button" className="btn btn-secondary" onClick={onLeave}>
          Leave waiting room
        </button>
      </section>

      <section className="stack" aria-label="Your camera preview">
        <VideoTile
          stream={media.stream}
          hasVideo={Boolean(media.videoTrack)}
          name={self.displayName}
          label={`${self.displayName} (you)`}
          micMuted={!media.micOn}
          isLocal
        />
        <div className="preview-toolbar">
          <MediaControls media={media} />
        </div>
      </section>
    </div>
  );
}
