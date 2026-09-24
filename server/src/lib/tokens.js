import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from './AppError.js';

// Two kinds of token, told apart by their audience so one can never be used
// as the other:
//  - session:     "this browser is signed in as user X" (httpOnly cookie, 7 days)
//  - participant: "this person is in meeting M with role R" (Bearer + socket auth, 2 h)
const ALGORITHM = 'HS256';
const PARTICIPANT_AUDIENCE = 'confer:participant';
const SESSION_AUDIENCE = 'confer:session';
export const PARTICIPANT_TOKEN_TTL = '2h';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export function signParticipantToken({ participantId, meetingId, code, role, displayName }) {
  return jwt.sign({ mid: meetingId, code, role, name: displayName }, env.JWT_SECRET, {
    algorithm: ALGORITHM,
    audience: PARTICIPANT_AUDIENCE,
    subject: participantId,
    expiresIn: PARTICIPANT_TOKEN_TTL,
  });
}

export function verifyParticipantToken(token) {
  if (typeof token !== 'string' || token.length === 0) {
    throw AppError.unauthorized('Missing participant token');
  }
  const payload = verify(token, PARTICIPANT_AUDIENCE, 'Invalid participant token');
  return {
    participantId: payload.sub,
    meetingId: payload.mid,
    code: payload.code,
    role: payload.role,
    displayName: payload.name,
  };
}

export function signSessionToken(userId) {
  return jwt.sign({}, env.JWT_SECRET, {
    algorithm: ALGORITHM,
    audience: SESSION_AUDIENCE,
    subject: userId,
    expiresIn: SESSION_TTL_SECONDS,
  });
}

/** Returns the user id, or throws 401. */
export function verifySessionToken(token) {
  return verify(token, SESSION_AUDIENCE, 'Your session is invalid. Please sign in again.').sub;
}

function verify(token, audience, invalidMessage) {
  try {
    // Pin the algorithm: never let the token header choose how it's verified.
    return jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM], audience });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw AppError.unauthorized('Your session has expired. Please sign in again.', 'TOKEN_EXPIRED');
    }
    throw AppError.unauthorized(invalidMessage);
  }
}
