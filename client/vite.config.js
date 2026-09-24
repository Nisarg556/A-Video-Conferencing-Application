import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Same-origin in dev: the browser calls /api on :5173 and Vite forwards
      // it to Express, so no CORS is involved locally.
      proxy: {
        '/api': env.API_PROXY_TARGET || 'http://localhost:4000',
      },
    },
  };
});
