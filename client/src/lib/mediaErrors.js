const DEVICE_NAMES = { audio: 'microphone', video: 'camera' };

/**
 * Turns a getUserMedia DOMException into something a person can act on.
 * reason: 'denied' | 'not-found' | 'in-use' | 'ended' | 'unknown'
 */
export function describeMediaError(err, kind) {
  const device = DEVICE_NAMES[kind];

  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        reason: 'denied',
        message: `Access to your ${device} is blocked. Allow it from the camera icon in the address bar (or site settings), then click “Try again”.`,
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { reason: 'not-found', message: `No ${device} was found. Connect one and click “Try again”.` };
    case 'NotReadableError':
    case 'AbortError':
      return {
        reason: 'in-use',
        message: `Your ${device} is in use by another app (Zoom, Teams, another tab…). Close it and click “Try again”.`,
      };
    default:
      return { reason: 'unknown', message: `Couldn’t start your ${device}. Click “Try again”.` };
  }
}

export function deviceDisconnectedError(kind) {
  return { reason: 'ended', message: `Your ${DEVICE_NAMES[kind]} was disconnected.` };
}
