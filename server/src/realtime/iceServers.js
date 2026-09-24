import { createHmac } from 'node:crypto';
import { env } from '../config/env.js';

// Long enough to outlive a participant token (2 h) so a call never loses its
// relay mid-meeting; short enough that a leaked credential soon stops working.
export const TURN_CREDENTIAL_TTL_SECONDS = 3 * 60 * 60;

/**
 * RTCPeerConnection configuration handed to a participant when they join.
 *
 * STUN: lets a browser discover its public address (free, stateless).
 * TURN: relays media when no direct path exists (symmetric NAT, UDP-blocking
 *       firewalls). It costs bandwidth, so it must not be an open relay:
 *   - TURN_SECRET (preferred, coturn "use-auth-secret"): we mint per-user,
 *     time-limited credentials: username = "<expiry>:<participantId>",
 *     credential = base64(HMAC-SHA1(secret, username)). coturn recomputes the
 *     HMAC, so the secret itself never leaves the server.
 *   - TURN_USERNAME/TURN_CREDENTIAL: static credentials (e.g. a managed TURN
 *     free tier). Only participants who joined a meeting ever see them.
 */
export function getRtcConfig(participantId, config = env, now = Date.now()) {
  const iceServers = [];

  if (config.STUN_URLS.length > 0) {
    iceServers.push({ urls: config.STUN_URLS });
  }

  if (config.TURN_URLS.length > 0) {
    iceServers.push({ urls: config.TURN_URLS, ...turnCredentials(participantId, config, now) });
  }

  // "relay" forces every connection through TURN — useful to prove TURN works.
  return { iceServers, iceTransportPolicy: config.ICE_TRANSPORT_POLICY };
}

function turnCredentials(participantId, config, now) {
  if (config.TURN_SECRET) {
    const expiresAt = Math.floor(now / 1000) + TURN_CREDENTIAL_TTL_SECONDS;
    const username = `${expiresAt}:${participantId}`;
    const credential = createHmac('sha1', config.TURN_SECRET).update(username).digest('base64');
    return { username, credential };
  }
  return { username: config.TURN_USERNAME, credential: config.TURN_CREDENTIAL };
}
