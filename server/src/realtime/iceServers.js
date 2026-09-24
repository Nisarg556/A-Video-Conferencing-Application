// ICE servers handed to clients on join. STUN only for now; short-lived TURN
// credentials get added here in a later milestone (never ship static TURN
// credentials in the frontend bundle).
export function getIceServers() {
  return [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
}
