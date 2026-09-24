import { env } from '../config/env.js';
import { AppError } from '../lib/AppError.js';
import { SESSION_TTL_SECONDS, signSessionToken, verifySessionToken } from '../lib/tokens.js';
import { User } from '../modules/users/user.model.js';

export const SESSION_COOKIE = 'confer_session';

// httpOnly: page scripts (and any XSS) can't read the session.
// SameSite=Lax: the browser won't attach it to POSTs from other sites (CSRF).
// Secure in production: only sent over HTTPS.
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: env.isProduction,
  path: '/',
});

export function setSessionCookie(res, userId) {
  res.cookie(SESSION_COOKIE, signSessionToken(userId), { ...cookieOptions(), maxAge: SESSION_TTL_SECONDS * 1000 });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/**
 * Optional auth for every request: sets req.user if a valid session cookie is
 * present. A bad/expired cookie is cleared and treated as signed out, so a
 * guest-friendly route still works.
 */
export async function loadUser(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  try {
    const user = await User.findById(verifySessionToken(token));
    if (user) req.user = user;
    else clearSessionCookie(res); // account deleted
  } catch (err) {
    if (!(err instanceof AppError)) return next(err);
    clearSessionCookie(res);
  }
  next();
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(AppError.unauthorized('Sign in to do that', 'AUTH_REQUIRED'));
  next();
}
