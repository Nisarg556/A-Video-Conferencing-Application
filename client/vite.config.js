import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.API_PROXY_TARGET || 'http://localhost:4000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Same-origin in dev: the browser calls /api and /socket.io on :5173 and
      // Vite forwards them to Express, so no CORS is involved locally.
      proxy: {
        '/api': target,
        '/socket.io': { target, ws: true },
      },
    },
  };
});
