import { randomUUID } from 'node:crypto';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { isDbConnected } from './db/connect.js';
import { logger as defaultLogger } from './lib/logger.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { loadUser } from './middleware/session.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createChatRouter } from './modules/chat/chat.routes.js';
import { createMeRouter, createMeetingRouter } from './modules/meetings/meeting.routes.js';
import { RoomManager } from './realtime/roomManager.js';

const REQUEST_ID = /^[\w-]{1,64}$/;

/**
 * Builds the Express app without listening, so tests can drive it with supertest.
 *
 * rooms:      shared with the Socket.IO server so REST can see live presence
 * logger:     pino instance (tests inject one to inspect output)
 * clientDist: path to the built React app; when set (production), the API also
 *             serves the SPA so app + API + WebSocket share one origin. That
 *             keeps the SameSite session cookie first-party and needs no CORS.
 */
export function createApp({ rooms = new RoomManager(), logger = defaultLogger, clientDist } = {}) {
  const app = express();

  // Behind Render/Railway/Fly's proxy, trust the first hop so req.ip
  // (used by rate limiting) is the real client address.
  if (env.isProduction) app.set('trust proxy', 1);

  // One structured log line per API request, with a request id that is also
  // returned to the client (X-Request-Id) and included in 500 responses.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      autoLogging: { ignore: (req) => req.url === '/api/health' || !req.url.startsWith('/api') },
      // Lean lines: no headers, user agents or IPs (noise, cost and personal
      // data we don't need). Redaction in the logger still backs this up.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  const wsOrigin = env.CLIENT_URL.replace(/^http/, 'ws');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Socket.IO over wss:// on our own origin; nothing else is contacted.
          'connect-src': ["'self'", wsOrigin],
          'media-src': ["'self'", 'blob:'],
          'img-src': ["'self'", 'data:'],
        },
      },
    }),
  );
  // Only this site may use the camera, mic and screen capture (not iframes/ads).
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=()');
    next();
  });
  // credentials: the session cookie may be sent by the configured frontend only.
  app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    const db = isDbConnected() ? 'up' : 'down';
    res.status(db === 'up' ? 200 : 503).json({ status: db === 'up' ? 'ok' : 'degraded', db });
  });

  app.use('/api', apiLimiter);
  app.use('/api', loadUser); // sets req.user when a valid session cookie is present
  app.use('/api/auth', createAuthRouter());
  app.use('/api/me', createMeRouter());
  app.use('/api/meetings/:code/messages', createChatRouter({ rooms }));
  app.use('/api/meetings', createMeetingRouter({ rooms }));

  if (clientDist) {
    // Hashed build assets can be cached forever; index.html must always be revalidated.
    app.use(
      express.static(clientDist, {
        index: false,
        setHeaders: (res, filePath) => {
          res.setHeader(
            'Cache-Control',
            filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
          );
        },
      }),
    );
    // Client-side routes (/m/abc-defg-hij, /meetings, …) all load the SPA.
    app.get(/^\/(?!api(\/|$)|socket\.io(\/|$)).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
