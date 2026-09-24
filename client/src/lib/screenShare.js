export function isScreenShareSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);
}

/**
 * Captures the screen and claims the meeting's presenter slot.
 *
 * Order matters: getDisplayMedia() must run first, while the click's
 * "user activation" is still valid; only then do we ask the server.
 *
 * Resolves to one of:
 *   { status: 'started', track }      track's "ended" (browser's Stop sharing) calls onEnded
 *   { status: 'cancelled' }           user closed the picker: not an error
 *   { status: 'busy', message }       someone else is presenting
 *   { status: 'error', message }
 */
export async function startScreenShare({ getDisplayMedia, claim, release, onEnded }) {
  let stream;
  try {
    stream = await getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 30 } }, // text stays sharp; motion isn't the point
      audio: false,
    });
  } catch (err) {
    if (err?.name === 'NotAllowedError' && /system/i.test(err.message ?? '')) {
      // e.g. macOS: the browser lacks the OS "Screen Recording" permission.
      return {
        status: 'error',
        message: 'Your operating system blocked screen sharing. Allow screen recording for this browser in system settings.',
      };
    }
    if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') return { status: 'cancelled' };
    return { status: 'error', message: 'Couldn’t start screen sharing.' };
  }

  const [track] = stream.getVideoTracks();
  const stopCapture = () => stream.getTracks().forEach((t) => t.stop());
  if (!track) {
    stopCapture();
    return { status: 'error', message: 'Couldn’t start screen sharing.' };
  }
  if ('contentHint' in track) track.contentHint = 'detail'; // favour sharpness over frame rate

  let result;
  try {
    result = await claim();
  } catch {
    result = { ok: false, error: { code: 'NETWORK_ERROR', message: 'Couldn’t reach the server. Try again.' } };
  }

  if (!result?.ok) {
    stopCapture();
    return {
      status: result?.error?.code === 'SCREEN_SHARE_BUSY' ? 'busy' : 'error',
      message: result?.error?.message ?? 'Couldn’t start screen sharing.',
    };
  }

  // The user may have pressed the browser's "Stop sharing" while we waited.
  if (track.readyState === 'ended') {
    release();
    return { status: 'cancelled' };
  }

  track.addEventListener('ended', onEnded, { once: true });
  return { status: 'started', track };
}
