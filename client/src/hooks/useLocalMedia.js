import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeMediaError, deviceDisconnectedError } from '../lib/mediaErrors.js';

const KINDS = ['audio', 'video'];
const CONSTRAINTS = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
};

function constraintsFor(kind, deviceId) {
  return { [kind]: deviceId ? { ...CONSTRAINTS[kind], deviceId: { exact: deviceId } } : CONSTRAINTS[kind] };
}

async function acquireTrack(kind, deviceId) {
  const stream = await navigator.mediaDevices.getUserMedia(constraintsFor(kind, deviceId));
  return stream.getTracks()[0];
}

async function permissionState(kind) {
  try {
    const name = kind === 'audio' ? 'microphone' : 'camera';
    return (await navigator.permissions.query({ name })).state; // granted | denied | prompt
  } catch {
    return 'unknown'; // Permissions API missing or doesn't know this name
  }
}

/**
 * Owns the local camera + microphone for the whole meeting page, so the
 * permission prompt happens once in the lobby and the same tracks carry into
 * the call.
 *
 * - Camera off = track stopped (the camera light turns off), re-acquired on.
 * - Mic off    = track.enabled = false (instant; the track stays alive).
 * - Each kind fails independently: no camera shouldn't block the microphone.
 */
export function useLocalMedia({ enabled = true } = {}) {
  const supported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  const [tracks, setTracks] = useState({ audio: null, video: null });
  const [errors, setErrors] = useState({ audio: null, video: null });
  const [status, setStatus] = useState(supported ? 'idle' : 'unsupported'); // idle|requesting|ready|unsupported
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [devices, setDevices] = useState({ audio: [], video: [] });
  const [selected, setSelected] = useState({ audio: '', video: '' });

  const tracksRef = useRef(tracks);
  const micOnRef = useRef(micOn);
  const camOnRef = useRef(camOn);
  // Bumped whenever a request for a kind starts or the hook unmounts. A
  // getUserMedia promise that resolves with an outdated generation is stale
  // (e.g. React StrictMode's double effect) and its track is stopped at once.
  const generation = useRef({ audio: 0, video: 0 });

  const setError = useCallback((kind, error) => setErrors((prev) => ({ ...prev, [kind]: error })), []);

  const refreshDevices = useCallback(async () => {
    if (!supported) return;
    const list = await navigator.mediaDevices.enumerateDevices();
    const pick = (type, fallback) =>
      list
        .filter((d) => d.kind === type && d.deviceId)
        .map((d, i) => ({ id: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));
    setDevices({ audio: pick('audioinput', 'Microphone'), video: pick('videoinput', 'Camera') });
  }, [supported]);

  const setTrack = useCallback(
    (kind, track) => {
      const previous = tracksRef.current[kind];
      if (previous && previous !== track) previous.stop();

      if (track) {
        if (kind === 'audio') track.enabled = micOnRef.current;
        const deviceId = track.getSettings().deviceId;
        if (deviceId) setSelected((prev) => ({ ...prev, [kind]: deviceId }));
        // Fires when the device is unplugged or revoked, not when we call stop().
        track.addEventListener('ended', () => {
          if (tracksRef.current[kind] !== track) return;
          tracksRef.current = { ...tracksRef.current, [kind]: null };
          setTracks(tracksRef.current);
          setError(kind, deviceDisconnectedError(kind));
          refreshDevices();
        });
      }

      tracksRef.current = { ...tracksRef.current, [kind]: track };
      setTracks(tracksRef.current);
    },
    [refreshDevices, setError],
  );

  /** Commits a freshly acquired track unless the request went stale meanwhile. */
  const commit = useCallback(
    (kind, gen, track) => {
      if (gen !== generation.current[kind] || (kind === 'video' && !camOnRef.current)) {
        track?.stop();
        return false;
      }
      setTrack(kind, track);
      return true;
    },
    [setTrack],
  );

  const start = useCallback(async () => {
    if (!supported) return;
    const gens = { audio: ++generation.current.audio, video: ++generation.current.video };
    const wanted = { audio: true, video: camOnRef.current };
    setStatus('requesting');
    setErrors({ audio: null, video: null });

    const got = { audio: null, video: null };
    const failed = { audio: null, video: null };

    try {
      // One combined request = one permission prompt in most browsers.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: CONSTRAINTS.audio,
        ...(wanted.video && { video: CONSTRAINTS.video }),
      });
      got.audio = stream.getAudioTracks()[0] ?? null;
      got.video = stream.getVideoTracks()[0] ?? null;
    } catch (err) {
      // The combined request fails if EITHER device fails, so find out which.
      let retry = KINDS.filter((k) => wanted[k]);
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        // Only retry a device that isn't explicitly blocked. If nothing is
        // blocked, the user dismissed the prompt; don't nag with two more.
        const states = Object.fromEntries(await Promise.all(retry.map(async (k) => [k, await permissionState(k)])));
        const anyDenied = retry.some((k) => states[k] === 'denied');
        retry = anyDenied ? retry.filter((k) => states[k] !== 'denied' && states[k] !== 'unknown') : [];
      }
      for (const kind of KINDS) if (wanted[kind] && !retry.includes(kind)) failed[kind] = err;

      const results = await Promise.allSettled(retry.map((kind) => acquireTrack(kind)));
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') got[retry[i]] = result.value;
        else failed[retry[i]] = result.reason;
      });
    }

    for (const kind of KINDS) {
      if (got[kind]) commit(kind, gens[kind], got[kind]);
      else if (failed[kind] && gens[kind] === generation.current[kind]) {
        setError(kind, describeMediaError(failed[kind], kind));
      }
    }
    if (gens.audio === generation.current.audio) {
      setStatus('ready');
      refreshDevices().catch(() => {});
    }
  }, [supported, commit, refreshDevices, setError]);

  /** (Re)acquires one device, e.g. after toggling the camera on or switching devices. */
  const acquire = useCallback(
    async (kind, deviceId) => {
      const gen = ++generation.current[kind];
      setError(kind, null);
      try {
        const track = await acquireTrack(kind, deviceId);
        if (commit(kind, gen, track)) refreshDevices().catch(() => {});
      } catch (err) {
        if (gen === generation.current[kind]) setError(kind, describeMediaError(err, kind));
      }
    },
    [commit, refreshDevices, setError],
  );

  const stopAll = useCallback(() => {
    for (const kind of KINDS) {
      generation.current[kind]++;
      tracksRef.current[kind]?.stop();
    }
    tracksRef.current = { audio: null, video: null };
    setTracks(tracksRef.current);
  }, []);

  // Request devices once enabled (i.e. after we know the meeting exists).
  useEffect(() => {
    if (!enabled || !supported) return;
    start();
    return stopAll; // releases the camera/mic when the page unmounts
  }, [enabled, supported, start, stopAll]);

  // Device lists change when headsets or webcams are plugged in or removed.
  useEffect(() => {
    if (!supported) return;
    const onChange = () => refreshDevices().catch(() => {});
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange);
  }, [supported, refreshDevices]);

  const toggleMic = useCallback(() => {
    const next = !micOnRef.current;
    micOnRef.current = next;
    setMicOn(next);
    const track = tracksRef.current.audio;
    if (track) track.enabled = next;
    else if (next) acquire('audio', selected.audio);
  }, [acquire, selected.audio]);

  const toggleCamera = useCallback(() => {
    const next = !camOnRef.current;
    camOnRef.current = next;
    setCamOn(next);
    if (next) {
      acquire('video', selected.video);
    } else {
      generation.current.video++; // cancel any in-flight camera request
      setTrack('video', null);
      setError('video', null);
    }
  }, [acquire, selected.video, setError, setTrack]);

  const selectDevice = useCallback(
    (kind, deviceId) => {
      setSelected((prev) => ({ ...prev, [kind]: deviceId }));
      if (kind === 'video' && !camOnRef.current) return; // use it next time the camera turns on
      acquire(kind, deviceId);
    },
    [acquire],
  );

  const retry = useCallback(() => {
    stopAll();
    start();
  }, [start, stopAll]);

  // A new MediaStream object whenever the set of tracks changes, so <video>
  // elements re-bind via their srcObject effect.
  const stream = useMemo(() => {
    const list = [tracks.audio, tracks.video].filter(Boolean);
    return list.length > 0 ? new MediaStream(list) : null;
  }, [tracks]);

  return {
    status,
    stream,
    audioTrack: tracks.audio,
    videoTrack: tracks.video,
    errors,
    micOn,
    camOn,
    devices,
    selected,
    toggleMic,
    toggleCamera,
    selectDevice,
    retry,
    stopAll,
  };
}
