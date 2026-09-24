// Small helpers shared by the Socket.IO handlers.
import { AppError } from '../lib/AppError.js';
import { logger } from '../lib/logger.js';

/** The ack callback is the last argument if the client asked for one. */
export function ackFrom(args) {
  const last = args[args.length - 1];
  return typeof last === 'function' ? last : () => {};
}

/** Same error shape as the REST API. */
export function fail(code, message) {
  return { ok: false, error: { code, message } };
}

/** Fixed-window counter: returns true while under `max` events in the current window. */
export function createRateLimiter({ max, windowMs }) {
  let windowStart = Date.now();
  let count = 0;
  return () => {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count <= max;
  };
}

/** Fire-and-forget DB writes must not crash the socket handler; log instead. */
export function persist(promise) {
  promise.catch((err) => logger.error({ err }, 'background persistence failed'));
}

/**
 * Turns an exception from a handler into an ack: expected AppErrors keep
 * their code (e.g. MEETING_ENDED); anything else is logged and hidden.
 */
export function failFromError(err, context) {
  if (err instanceof AppError) return fail(err.code, err.message);
  logger.error({ err, ...context }, 'socket handler failed');
  return fail('INTERNAL_ERROR', 'Something went wrong');
}
