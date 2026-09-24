// Small helpers shared by the Socket.IO handlers.

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
  promise.catch((err) => console.error('background persistence failed', err));
}
