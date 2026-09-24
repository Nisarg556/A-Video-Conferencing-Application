import { Router } from 'express';
import { authLimiter } from '../../middleware/rateLimit.js';
import { clearSessionCookie, requireUser, setSessionCookie } from '../../middleware/session.js';
import { validate } from '../../middleware/validate.js';
import { loginSchema, registerSchema } from './auth.schemas.js';
import * as authService from './auth.service.js';

// Mounted at /api/auth
export function createAuthRouter() {
  const router = Router();

  // POST /api/auth/register { name, email, password } -> 201 { user } + session cookie
  router.post('/register', authLimiter, validate(registerSchema), async (req, res) => {
    const user = await authService.registerUser(req.validated.body);
    setSessionCookie(res, user.id);
    res.status(201).json({ user: user.toPublic() });
  });

  // POST /api/auth/login { email, password } -> 200 { user } + session cookie | 401 INVALID_CREDENTIALS
  router.post('/login', authLimiter, validate(loginSchema), async (req, res) => {
    const user = await authService.authenticate(req.validated.body);
    setSessionCookie(res, user.id);
    res.json({ user: user.toPublic() });
  });

  // POST /api/auth/logout -> 204, cookie cleared
  router.post('/logout', (_req, res) => {
    clearSessionCookie(res);
    res.status(204).end();
  });

  // GET /api/auth/me -> 200 { user } | 401 AUTH_REQUIRED
  router.get('/me', requireUser, (req, res) => {
    res.json({ user: req.user.toPublic() });
  });

  return router;
}
