import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Structured JSON logs (one object per line) so a hosting platform can search
 * and filter them, e.g. every event for one meeting code or request id.
 *
 * Secrets never reach the log: auth headers, cookies, tokens and passwords are
 * redacted wherever they appear. We log participant/meeting ids, not chat
 * text or display names.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.passwordHash',
];

export function createLogger(options = {}, destination) {
  return pino(
    {
      level: env.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      base: { service: 'confer-api' },
      // Human-readable output locally; raw JSON everywhere else.
      ...(env.NODE_ENV === 'development' && !destination && {
        transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' } },
      }),
      ...options,
    },
    destination,
  );
}

export const logger = createLogger();

/** "mongodb+srv://user:pass@host/db" -> "mongodb+srv://***@host/db" */
export function redactUri(uri) {
  return String(uri).replace(/\/\/[^@/]+@/, '//***@');
}
