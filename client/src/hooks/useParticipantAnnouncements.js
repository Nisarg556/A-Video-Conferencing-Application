import { useEffect, useRef, useState } from 'react';

/**
 * Text for a visually hidden aria-live region: "Ada joined", "Bo left".
 * Sighted users see tiles appear; screen-reader users otherwise wouldn't know.
 */
export function useParticipantAnnouncements(peers, enabled) {
  const [message, setMessage] = useState('');
  const previous = useRef(null);

  useEffect(() => {
    const current = new Map(peers.map((p) => [p.participantId, p.displayName]));
    if (!enabled) {
      previous.current = null;
      return;
    }
    // The first snapshot after joining isn't news.
    if (previous.current) {
      const joined = [...current].filter(([id]) => !previous.current.has(id)).map(([, name]) => `${name} joined`);
      const left = [...previous.current].filter(([id]) => !current.has(id)).map(([, name]) => `${name} left`);
      const changes = [...joined, ...left];
      if (changes.length > 0) setMessage(changes.join('. '));
    }
    previous.current = current;
  }, [peers, enabled]);

  return message;
}
