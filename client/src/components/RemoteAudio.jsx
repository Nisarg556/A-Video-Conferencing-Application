import { useEffect, useRef } from 'react';

/**
 * Plays one participant's audio. Kept separate from the video tile so audio
 * keeps playing when their camera is off (the tile then shows an avatar).
 */
export function RemoteAudio({ stream }) {
  const ref = useRef(null);

  useEffect(() => {
    const audio = ref.current;
    if (!audio || !stream) return;
    audio.srcObject = stream;

    // Autoplay with sound needs a prior user gesture. Joining is a click, so
    // this normally works; if the browser still blocks it, retry on next click.
    const play = () => audio.play().catch(() => {});
    audio.play().catch(() => document.addEventListener('pointerdown', play, { once: true }));
    return () => document.removeEventListener('pointerdown', play);
  }, [stream]);

  return <audio ref={ref} autoPlay />;
}
