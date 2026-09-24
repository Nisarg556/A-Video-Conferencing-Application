// The host key proves "I created this meeting". It is returned once by the
// API and kept in this browser only. Storage can throw (private mode,
// blocked site data), so every access is guarded.
const PREFIX = 'confer:hostKey:';

export function saveHostKey(code, hostKey) {
  try {
    localStorage.setItem(PREFIX + code, hostKey);
  } catch {
    /* non-fatal: the user just won't have host controls later */
  }
}

export function getHostKey(code) {
  try {
    return localStorage.getItem(PREFIX + code);
  } catch {
    return null;
  }
}
