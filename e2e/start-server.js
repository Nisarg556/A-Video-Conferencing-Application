// Starts the app the way it runs in production (Express serves the built
// client, API and Socket.IO on one origin) against a throwaway in-memory
// MongoDB. Used by Playwright's webServer; run `npm run build` first.
import { MongoMemoryServer } from 'mongodb-memory-server';

const PORT = process.env.E2E_PORT ?? '4100';
const mongo = await MongoMemoryServer.create();

Object.assign(process.env, {
  NODE_ENV: 'production',
  PORT,
  MONGODB_URI: mongo.getUri('confer-e2e'),
  CLIENT_URL: `http://localhost:${PORT}`,
  JWT_SECRET: 'e2e-secret-that-is-at-least-32-characters-long',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
});

const stop = async () => {
  await mongo.stop();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

await import('../server/src/index.js');
