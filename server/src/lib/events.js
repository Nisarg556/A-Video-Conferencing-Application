import { EventEmitter } from 'node:events';

// Decouples the REST layer from the realtime layer: services announce domain
// events ("meeting ended") and the Socket.IO server decides how to react.
//   'ended' -> { code, reason: 'host_ended' | 'expired' }
export const meetingEvents = new EventEmitter();
