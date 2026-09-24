import { useEffect, useRef } from 'react';

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

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser); // not connected to speakers: no echo
    const samples = new Uint8Array(analyser.fftSize);

    // Browsers may start an AudioContext suspended until the user interacts.
    const resume = () => ctx.resume().catch(() => {});
    if (ctx.state === 'suspended') window.addEventListener('pointerdown', resume, { once: true });

    let frame;
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += ((s - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / samples.length);
      bar.style.transform = `scaleX(${Math.min(1, rms * 4).toFixed(3)})`;
      frame = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', resume);
      source.disconnect();
      ctx.close().catch(() => {});
    };
  }, [track, active]);

  return (
    <div className="mic-level" role="presentation" title="Microphone level">
      <div ref={barRef} className="mic-level-bar" />
    </div>
  );
}
