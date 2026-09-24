import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Tests start their own in-memory Mongo, so the URI here is a placeholder
    // that only satisfies env validation.
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://placeholder/test',
      CLIENT_URL: 'http://localhost:5173',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    },
    // First run downloads a MongoDB binary for mongodb-memory-server.
    hookTimeout: 120_000,
  },
});
