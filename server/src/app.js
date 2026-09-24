import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { isDbConnected } from './db/connect.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { loadUser } from './middleware/session.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createChatRouter } from './modules/chat/chat.routes.js';
import { createMeRouter, createMeetingRouter } from './modules/meetings/meeting.routes.js';
import { RoomManager } from './realtime/roomManager.js';

// Builds the Express app without listening, so tests can drive it with supertest.
// `rooms` is shared with the Socket.IO server so REST can see live presence.
export function createApp({ rooms = new RoomManager() } = {}) {
  const app = express();

  // Behind Render/Railway/Fly's proxy, trust the first hop so req.ip
  // (used by rate limiting) is the real client address.
  if (env.isProduction) app.set('trust proxy', 1);

  app.use(helmet());
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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
