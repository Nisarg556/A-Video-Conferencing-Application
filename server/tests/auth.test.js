import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { User } from '../src/modules/users/user.model.js';
import { clearDb, signUp, startTestDb, TEST_PASSWORD } from './helpers.js';

let stopDb;
let app;

beforeAll(async () => {
  stopDb = await startTestDb();
  app = createApp();
});

afterAll(async () => {
  await stopDb?.();
});

beforeEach(clearDb);

const sessionCookie = (res) => res.headers['set-cookie']?.find((c) => c.startsWith('confer_session='));

describe('POST /api/auth/register', () => {
  it('creates the account, hashes the password and signs the user in with an httpOnly cookie', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: ' Ada ', email: ' Ada@Example.COM ', password: TEST_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({ id: expect.any(String), name: 'Ada', email: 'ada@example.com', createdAt: expect.any(String) });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);

    const stored = await User.findOne({ email: 'ada@example.com' }).select('+passwordHash');
    expect(stored.passwordHash).toMatch(/^scrypt\$/);
    expect(stored.passwordHash).not.toContain(TEST_PASSWORD);
  });

  it('rejects a duplicate email (case-insensitive)', async () => {
    await request(app).post('/api/auth/register').send({ name: 'A', email: 'a@x.com', password: TEST_PASSWORD });
    const res = await request(app).post('/api/auth/register').send({ name: 'B', email: 'A@X.com', password: TEST_PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it.each([
    [{ email: 'a@x.com', password: TEST_PASSWORD }, 'name'],
    [{ name: 'A', email: 'not-an-email', password: TEST_PASSWORD }, 'email'],
    [{ name: 'A', email: 'a@x.com', password: 'short' }, 'password'],
    [{ name: 'A', email: 'a@x.com', password: 'x'.repeat(129) }, 'password'],
  ])('validates input (%j)', async (body, path) => {
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe(path);
  });
});

describe('POST /api/auth/login', () => {
  it('signs in with the right password', async () => {
    const agent = await signUp(app, { name: 'Ada' });
    const res = await request(app).post('/api/auth/login').send({ email: agent.email.toUpperCase(), password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Ada');
    expect(sessionCookie(res)).toBeDefined();
  });

  it('gives the same answer for a wrong password and an unknown email (no account enumeration)', async () => {
    const agent = await signUp(app);
    const wrongPassword = await request(app).post('/api/auth/login').send({ email: agent.email, password: 'wrong-password' });
    const unknownEmail = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever1' });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
      expect(sessionCookie(res)).toBeUndefined();
    }
  });
});

describe('session', () => {
  it('GET /me returns the signed-in user, and 401 without a session', async () => {
    const agent = await signUp(app, { name: 'Ada' });
    expect((await agent.get('/api/auth/me')).body.user.name).toBe('Ada');

    const anonymous = await request(app).get('/api/auth/me');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('logout clears the cookie', async () => {
    const agent = await signUp(app);
    const res = await agent.post('/api/auth/logout');
    expect(res.status).toBe(204);
    expect(sessionCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('treats forged, expired and participant tokens in the cookie as signed out', async () => {
    const agent = await signUp(app);
    const forged = jwt.sign({}, 'not-the-server-secret-but-long-enough!!', { audience: 'confer:session', subject: agent.user.id });
    const expired = jwt.sign({ exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET, {
      audience: 'confer:session',
      subject: agent.user.id,
    });
    // Right secret, wrong audience: a participant token must never work as a session.
    const wrongAudience = jwt.sign({}, process.env.JWT_SECRET, { audience: 'confer:participant', subject: agent.user.id });

    for (const token of [forged, expired, wrongAudience]) {
      const res = await request(app).get('/api/auth/me').set('Cookie', `confer_session=${token}`);
      expect(res.status).toBe(401);
      const create = await request(app).post('/api/meetings').set('Cookie', `confer_session=${token}`).send({});
      expect(create.status).toBe(401);
    }
  });

  it('a session token cannot be used as a participant token', async () => {
    const register = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Ada', email: 'ada@example.com', password: TEST_PASSWORD });
    const sessionToken = /confer_session=([^;]+)/.exec(sessionCookie(register))[1];
    const res = await request(app).post('/api/meetings').set('Cookie', `confer_session=${sessionToken}`).send({});
    expect(res.status).toBe(201);

    const end = await request(app)
      .post(`/api/meetings/${res.body.meeting.code}/end`)
      .set('Authorization', `Bearer ${sessionToken}`);
    expect(end.status).toBe(401);
  });
});
