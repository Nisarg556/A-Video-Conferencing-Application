import { useEffect, useRef } from 'react';
import { MicOffIcon } from './icons.jsx';

function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').concat(parts[1]?.[0] ?? '').toUpperCase();
}

/**
 * One participant's tile. Shows video when there is a live video track,
 * otherwise an avatar with their initials.
 */
export function VideoTile({ stream, hasVideo, name, label = name, micMuted, isLocal, badge, children }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = hasVideo ? stream : null;
  }, [stream, hasVideo]);

  return (
    <div className="tile">
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          // Always mute your own preview, or you'd hear yourself.
          muted={isLocal}
          className={isLocal ? 'mirror' : undefined}
        />
      ) : (
        <div className="avatar" aria-hidden="true">
          {initials(name)}
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
