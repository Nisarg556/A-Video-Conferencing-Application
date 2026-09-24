import { useEffect, useState } from 'react';
import { getMeeting } from '../api/meetings.js';

/** Loads public meeting details. state.status: 'loading' | 'success' | 'error' */
export function useMeeting(code) {
  const [state, setState] = useState({ status: 'loading', meeting: null, error: null });

  useEffect(() => {
    // Abort on unmount / code change so a slow response can't overwrite newer state.
    const controller = new AbortController();
    setState({ status: 'loading', meeting: null, error: null });

    getMeeting(code, { signal: controller.signal })
      .then(({ meeting }) => setState({ status: 'success', meeting, error: null }))
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setState({ status: 'error', meeting: null, error });
      });

    return () => controller.abort();
  }, [code]);

  return state;
}
