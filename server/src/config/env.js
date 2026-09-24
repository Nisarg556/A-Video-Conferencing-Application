import 'dotenv/config';
import { z } from 'zod';

const DEFAULT_STUN_URLS = 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302';

// "a, b,c" -> ['a', 'b', 'c']; empty string -> []
const iceUrlList = (fallback) =>
  z
    .string()
    .default(fallback)
    .transform((value) =>
      value
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(/^(stun|turns?):/, 'ICE URLs must start with stun:, turn: or turns:')));

// Treat "" the same as unset, so a blank line in .env doesn't count as a value.
const optionalString = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

// Validate environment once at startup so misconfiguration fails fast
// with a clear message instead of surfacing as a runtime bug later.
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    CLIENT_URL: z.string().url().default('http://localhost:5173'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

    // WebRTC NAT traversal (see server/.env.example)
    STUN_URLS: iceUrlList(DEFAULT_STUN_URLS),
    TURN_URLS: iceUrlList(''),
    TURN_SECRET: optionalString,
    TURN_USERNAME: optionalString,
    TURN_CREDENTIAL: optionalString,
    ICE_TRANSPORT_POLICY: z.enum(['all', 'relay']).default('all'),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.TURN_URLS.length > 0 && !cfg.TURN_SECRET && !(cfg.TURN_USERNAME && cfg.TURN_CREDENTIAL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['TURN_URLS'],
        message: 'TURN_URLS needs TURN_SECRET, or TURN_USERNAME and TURN_CREDENTIAL',
      });
    }
    if (cfg.ICE_TRANSPORT_POLICY === 'relay' && cfg.TURN_URLS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['ICE_TRANSPORT_POLICY'],
        message: 'ICE_TRANSPORT_POLICY=relay requires TURN_URLS',
      });
    }
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
