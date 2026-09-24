import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { isDbConnected } from './db/connect.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { meetingRouter } from './modules/meetings/meeting.routes.js';

// Builds the Express app without listening, so tests can drive it with supertest.
export function createApp() {
  const app = express();

  // Behind Render/Railway/Fly's proxy, trust the first hop so req.ip
  // (used by rate limiting) is the real client address.
  if (env.isProduction) app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_URL }));
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', (_req, res) => {
    const db = isDbConnected() ? 'up' : 'down';
    res.status(db === 'up' ? 200 : 503).json({ status: db === 'up' ? 'ok' : 'degraded', db });
  });

  app.use('/api', apiLimiter);
  app.use('/api/meetings', meetingRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
