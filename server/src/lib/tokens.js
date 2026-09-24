import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from './AppError.js';

// Participant tokens are short-lived and scoped to exactly one meeting.
// They authorize both REST calls (Bearer header) and the Socket.IO handshake.
const ALGORITHM = 'HS256';
const AUDIENCE = 'confer:participant';
export const PARTICIPANT_TOKEN_TTL = '2h';

export function signParticipantToken({ participantId, meetingId, code, role, displayName }) {
  return jwt.sign({ mid: meetingId, code, role, name: displayName }, env.JWT_SECRET, {
    algorithm: ALGORITHM,
    audience: AUDIENCE,
    subject: participantId,
    expiresIn: PARTICIPANT_TOKEN_TTL,
  });
}

export function verifyParticipantToken(token) {
  if (typeof token !== 'string' || token.length === 0) {
    throw AppError.unauthorized('Missing participant token');
  }
  try {
    // Pin the algorithm: never let the token header choose how it's verified.
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: [ALGORITHM],
      audience: AUDIENCE,
    });
    return {
      participantId: payload.sub,
      meetingId: payload.mid,
      code: payload.code,
      role: payload.role,
      displayName: payload.name,
    };
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw AppError.unauthorized('Your session has expired. Please rejoin.', 'TOKEN_EXPIRED');
    }
    throw AppError.unauthorized('Invalid participant token');
  }
}
