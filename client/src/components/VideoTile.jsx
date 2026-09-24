import { useEffect, useRef } from 'react';
import { MicOffIcon } from './icons.jsx';

function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').concat(parts[1]?.[0] ?? '').toUpperCase();
}

const CONNECTION_LABELS = {
  new: 'Connecting…',
  connecting: 'Connecting…',
  disconnected: 'Reconnecting…',
  failed: 'Connection failed',
};

/**
 * One participant's tile: video when they're sending it, otherwise an avatar.
 * The <video> is always muted — audio is played by <RemoteAudio>.
 */
export function VideoTile({
  stream,
  hasVideo,
  name,
  label = name,
  micMuted,
  isLocal,
  badge,
  connectionState,
  children,
}) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = hasVideo ? stream : null;
  }, [stream, hasVideo]);

  const connectionLabel = CONNECTION_LABELS[connectionState];

  return (
    <div className="tile" data-connection-state={connectionState}>
      {hasVideo ? (
        <video ref={videoRef} autoPlay playsInline muted className={isLocal ? 'mirror' : undefined} />
      ) : (
        <div className="avatar" aria-hidden="true">
          {initials(name)}
        </div>
      )}

      {connectionLabel && (
        <div className={`tile-status ${connectionState === 'failed' ? 'tile-status-error' : ''}`} role="status">
          {connectionLabel}
        </div>
      )}

      <div className="tile-label">
        {micMuted && <MicOffIcon width="14" height="14" aria-label="Muted" />}
        <span>{label}</span>
        {badge && <span className="badge badge-small">{badge}</span>}
      </div>

      {children}
    </div>
  );
}
