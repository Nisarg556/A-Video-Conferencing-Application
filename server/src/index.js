import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { connectDb, disconnectDb } from './db/connect.js';
import { createApp } from './app.js';
import { logger, redactUri } from './lib/logger.js';
import { RoomManager } from './realtime/roomManager.js';
import { attachSocketServer } from './realtime/socketServer.js';

const CLIENT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

async function main() {
  try {
    await connectDb(env.MONGODB_URI);
    logger.info({ db: redactUri(env.MONGODB_URI) }, 'MongoDB connected');
  } catch (err) {
    // Never log the raw URI: on Atlas it contains the database password.
    logger.fatal({ err, db: redactUri(env.MONGODB_URI) }, 'Could not connect to MongoDB. Is it running? (npm run db:up)');
    process.exit(1);
  }

  // In production the API also serves the built client (same origin for the
  // app, the API, the session cookie and the WebSocket).
  const clientDist = env.isProduction && existsSync(CLIENT_DIST) ? CLIENT_DIST : undefined;
  if (env.isProduction && !clientDist) logger.warn('client/dist not found: serving the API only');

  // REST and Socket.IO share one HTTP server and one view of live presence.
  const rooms = new RoomManager();
  const server = http.createServer(createApp({ rooms, clientDist }));
  const realtime = attachSocketServer(server, { rooms });

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV, servingClient: Boolean(clientDist) }, 'Server listening');
  });

  // Graceful shutdown: close sockets and the HTTP server, then the DB.
  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down');
    await realtime.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled promise rejection'));
}

main();
