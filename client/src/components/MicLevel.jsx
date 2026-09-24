import { useEffect, useRef } from 'react';
import { createAudioLevelMeter } from '../lib/audioLevel.js';

/**
 * Live input level for an audio track. Updates the DOM directly each animation
 * frame instead of setting React state 60 times a second.
 */
export function MicLevel({ track, active }) {
  const barRef = useRef(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!track || !active || !bar) {
      if (bar) bar.style.transform = 'scaleX(0)';
      return;
    }

    const meter = createAudioLevelMeter(track);
    let frame;
    const tick = () => {
      bar.style.transform = `scaleX(${Math.min(1, meter.getLevel() * 4).toFixed(3)})`;
      frame = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      meter.close();
    };
  }, [track, active]);

  return (
    <div className="mic-level" role="presentation" title="Microphone level">
      <div ref={barRef} className="mic-level-bar" />
    </div>
  );
}
