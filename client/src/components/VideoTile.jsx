import { useEffect, useRef } from 'react';
import { MicOffIcon, ScreenShareIcon } from './icons.jsx';

export function initials(name = '') {
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
 *
 * variant "screen": shows a shared screen uncropped (object-fit: contain).
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
  speaking,
  variant = 'camera',
  children,
}) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = hasVideo ? stream : null;
  }, [stream, hasVideo]);

  const connectionLabel = CONNECTION_LABELS[connectionState];
  const classes = ['tile', `tile-${variant}`, speaking && 'speaking'].filter(Boolean).join(' ');

  return (
    <div className={classes} data-connection-state={connectionState}>
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={isLocal && variant === 'camera' ? 'mirror' : undefined}
        />
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
        {variant === 'screen' && <ScreenShareIcon width="14" height="14" aria-hidden="true" />}
        {micMuted && <MicOffIcon width="14" height="14" aria-label="Muted" role="img" />}
        <span>{label}</span>
        {badge && <span className="badge badge-small">{badge}</span>}
        {speaking && <span className="sr-only">(speaking)</span>}
      </div>

      {children}
    </div>
  );
}
