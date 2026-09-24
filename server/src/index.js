import { env } from './config/env.js';
import { connectDb, disconnectDb } from './db/connect.js';
import { createApp } from './app.js';

async function main() {
  try {
    await connectDb(env.MONGODB_URI);
  } catch (err) {
    console.error(`Could not connect to MongoDB at ${env.MONGODB_URI}`);
    console.error(`  ${err.message}`);
    console.error('  Is it running? For local Docker Mongo run: npm run db:up');
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  // Graceful shutdown: stop accepting connections, then close the DB.
  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
