import http from 'node:http';
import { env } from './config/env.js';
import { connectDb, disconnectDb } from './db/connect.js';
import { createApp } from './app.js';
import { RoomManager } from './realtime/roomManager.js';
import { attachSocketServer } from './realtime/socketServer.js';

async function main() {
  try {
    await connectDb(env.MONGODB_URI);
  } catch (err) {
    console.error(`Could not connect to MongoDB at ${env.MONGODB_URI}`);
    console.error(`  ${err.message}`);
    console.error('  Is it running? For local Docker Mongo run: npm run db:up');
    process.exit(1);
  }

  // REST and Socket.IO share one HTTP server and one view of live presence.
  const rooms = new RoomManager();
  const server = http.createServer(createApp({ rooms }));
  const realtime = attachSocketServer(server, { rooms });

  server.listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  // Graceful shutdown: close sockets and the HTTP server, then the DB.
  const shutdown = async (signal) => {
    console.log(`${signal} received, shutting down`);
    await realtime.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
