/**
 * Measures the loudness of an audio track with the Web Audio API.
 * Returns { getLevel(): 0..1 (RMS), close() }. The analyser isn't connected to
 * the speakers, so this never plays anything.
 */
export function createAudioLevelMeter(track) {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);

  // Browsers may start an AudioContext suspended until the user interacts.
  const resume = () => ctx.resume().catch(() => {});
  if (ctx.state === 'suspended') window.addEventListener('pointerdown', resume, { once: true });

  return {
    getLevel() {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += ((s - 128) / 128) ** 2;
      return Math.sqrt(sum / samples.length);
    },
    close() {
      window.removeEventListener('pointerdown', resume);
      source.disconnect();
      ctx.close().catch(() => {});
    },
  };
}
