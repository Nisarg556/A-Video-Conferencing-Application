import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../lib/AppError.js';

function limiter({ windowMs, limit }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Automated tests fire many requests from one IP within a second.
    skip: () => env.NODE_ENV === 'test',
    handler: (_req, _res, next) => next(AppError.tooManyRequests()),
  });
}

// Broad safety net for the whole API.
export const apiLimiter = limiter({ windowMs: 60_000, limit: 120 });

// Tighter limits where abuse is cheap: creating meetings, and looking up or
// joining by code (slows down anyone trying to guess meeting codes).
export const createMeetingLimiter = limiter({ windowMs: 60_000, limit: 10 });
export const lookupMeetingLimiter = limiter({ windowMs: 60_000, limit: 30 });
export const joinMeetingLimiter = limiter({ windowMs: 60_000, limit: 20 });
