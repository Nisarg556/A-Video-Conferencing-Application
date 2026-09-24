import { io } from 'socket.io-client';
import { API_BASE_URL } from '../api/http.js';

// One socket per joined meeting, authenticated with the participant token.
// WebSocket-only skips the long-polling fallback, which would need sticky
// sessions once there is more than one server instance.
export function createMeetingSocket(token) {
  return io(API_BASE_URL || undefined, {
    autoConnect: false,
    auth: { token },
    transports: ['websocket'],
  });
}
