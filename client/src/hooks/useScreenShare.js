import { useCallback, useEffect, useRef, useState } from 'react';
import { isScreenShareSupported, startScreenShare } from '../lib/screenShare.js';

function claimPresenter(socket) {
  if (!socket?.connected) {
    return Promise.resolve({
      ok: false,
      error: { code: 'OFFLINE', message: 'You’re disconnected. Wait for the connection to come back and try again.' },
    });
  }
  return socket.timeout(5000).emitWithAck('screen:start');
}

/**
 * Local side of screen sharing. Every way of stopping — our Stop button, the
 * browser's native "Stop sharing" bar, leaving, losing the slot — goes through
 * stop(), so the track is always released and the server always told.
 *
 * Used inside useMeetingRoom, which sends `track` instead of the camera.
 */
export function useScreenShare({ socketRef, joinCount }) {
  const [track, setTrack] = useState(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  const trackRef = useRef(null);

  const stop = useCallback(({ notifyServer = true } = {}) => {
    const current = trackRef.current;
    if (!current) return;
    trackRef.current = null;
    current.stop(); // removes the browser's "sharing" indicator
    setTrack(null);
    if (notifyServer && socketRef.current?.connected) socketRef.current.emit('screen:stop');
  }, [socketRef]);

  const start = useCallback(async () => {
    if (trackRef.current || starting) return;
    setError(null);
    setStarting(true);
    const result = await startScreenShare({
      getDisplayMedia: (constraints) => navigator.mediaDevices.getDisplayMedia(constraints),
      claim: () => claimPresenter(socketRef.current),
      release: () => socketRef.current?.emit('screen:stop'),
      onEnded: () => stop(),
    });
    setStarting(false);

    if (result.status === 'started') {
      trackRef.current = result.track;
      setTrack(result.track);
    } else if (result.status !== 'cancelled') {
      setError(result.message);
    }
  }, [socketRef, starting, stop]);

  // After a reconnect the server may have restarted and forgotten us: re-claim.
  useEffect(() => {
    if (joinCount === 0 || !trackRef.current) return;
    claimPresenter(socketRef.current)
      .then((result) => {
        if (!result.ok) {
          stop({ notifyServer: false });
          setError(result.error.message);
        }
      })
      .catch(() => {});
  }, [joinCount, socketRef, stop]);

  // Leaving the meeting / unmounting always ends the capture.
  useEffect(() => () => trackRef.current?.stop(), []);

  return {
    supported: isScreenShareSupported(),
    track,
    sharing: Boolean(track),
    starting,
    error,
    clearError: () => setError(null),
    start,
    stop,
  };
}
