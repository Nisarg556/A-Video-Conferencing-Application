import { AppError } from './AppError.js';

/**
 * Who may do what inside a meeting. This table is the single source of truth:
 * every REST route and socket event that needs a role checks it here.
 * Hiding a button in the UI is a convenience, never the security boundary.
 *
 * Roles are assigned by the server when a participant token is issued:
 *   host   — the signed-in user who owns the meeting
 *   member — any other signed-in user
 *   guest  — not signed in (only if the host allows guests)
 *
 * Being in the room (admitted, not waiting/removed) is checked separately.
 */
export const PERMISSIONS = Object.freeze({
  'meeting.end': ['host'],
  'meeting.updateSettings': ['host'],
  'lobby.admit': ['host'],
  'lobby.deny': ['host'],
  'participant.remove': ['host'],
  'screen.share': ['host', 'member', 'guest'],
  'chat.send': ['host', 'member', 'guest'],
});

export function can(role, action) {
  return PERMISSIONS[action]?.includes(role) ?? false;
}

/** Express middleware: run after requireParticipant. */
export function requirePermission(action) {
  return (req, _res, next) => {
    if (!can(req.participant?.role, action)) return next(AppError.forbidden('Only the host can do that'));
    next();
  };
}
