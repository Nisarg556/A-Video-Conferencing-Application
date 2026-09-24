import { useEffect, useRef, useState } from 'react';
import { ActiveSpeakerDetector } from '../lib/activeSpeaker.js';
import { createAudioLevelMeter } from '../lib/audioLevel.js';

const POLL_MS = 250;

/**
 * Who is speaking right now (participantId or null). Only runs when there is
 * someone else in the meeting — highlighting yourself alone is pointless.
 *
 * Remote levels come from the WebRTC receivers; our own from a local analyser.
 */
export function useActiveSpeaker({ enabled, getRemoteLevels, selfId, localTrack, localMicOn }) {
  const [speakerId, setSpeakerId] = useState(null);
  const getRemoteLevelsRef = useRef(getRemoteLevels);
  getRemoteLevelsRef.current = getRemoteLevels;
  const micOnRef = useRef(localMicOn);
  micOnRef.current = localMicOn;

  useEffect(() => {
    if (!enabled) {
      setSpeakerId(null);
      return;
    }
    const meter = localTrack ? createAudioLevelMeter(localTrack) : null;
    const detector = new ActiveSpeakerDetector();

    const timer = setInterval(() => {
      const levels = getRemoteLevelsRef.current();
      if (selfId) levels.set(selfId, meter && micOnRef.current ? meter.getLevel() : 0);
      setSpeakerId(detector.update(levels, Date.now())); // same id -> React skips the render
    }, POLL_MS);

    return () => {
      clearInterval(timer);
      meter?.close();
    };
  }, [enabled, selfId, localTrack]);

  return speakerId;
}
