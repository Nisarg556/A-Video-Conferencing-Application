// localStorage can throw (private mode, blocked site data), and nothing we
// keep there is essential, so every access is guarded.
const PREFIX = 'confer:';

export function readStored(key) {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writeStored(key, value) {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* non-fatal */
  }
}

// The host key proves "I created this meeting". It is returned once by the
// API and kept in this browser only.
export const saveHostKey = (code, hostKey) => writeStored(`hostKey:${code}`, hostKey);
export const getHostKey = (code) => readStored(`hostKey:${code}`);

export const saveDisplayName = (name) => writeStored('displayName', name);
export const getSavedDisplayName = () => readStored('displayName') ?? '';
