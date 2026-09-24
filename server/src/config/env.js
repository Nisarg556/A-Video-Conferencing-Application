import 'dotenv/config';
import { z } from 'zod';

// Validate environment once at startup so misconfiguration fails fast
// with a clear message instead of surfacing as a runtime bug later.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('See server/.env.example');
  process.exit(1);
}

export const env = Object.freeze({
  ...parsed.data,
  CLIENT_URL: parsed.data.CLIENT_URL.replace(/\/$/, ''),
  isProduction: parsed.data.NODE_ENV === 'production',
});
