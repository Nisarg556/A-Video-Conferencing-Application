import { AppError } from '../lib/AppError.js';
import { verifyParticipantToken } from '../lib/tokens.js';

/**
 * Requires "Authorization: Bearer <participant token>" for the meeting in
 * req.validated.params.code. Run it after validate() so the code is normalized.
 */
export function requireParticipant(req, _res, next) {
  const [scheme, token] = (req.get('authorization') ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(AppError.unauthorized('Missing participant token'));
  }

  const participant = verifyParticipantToken(token);
  // A token for meeting A must never act on meeting B.
  if (participant.code !== req.validated.params.code) {
    return next(AppError.forbidden('Token is not valid for this meeting'));
  }

  req.participant = participant;
  next();
}

export function requireHost(req, _res, next) {
  if (req.participant?.role !== 'host') {
    return next(AppError.forbidden('Only the host can do that'));
  }
  next();
}
