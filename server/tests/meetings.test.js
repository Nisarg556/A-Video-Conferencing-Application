import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Meeting, MEETING_IDLE_TTL_MS } from '../src/modules/meetings/meeting.model.js';
import { MEETING_CODE_REGEX, sha256 } from '../src/lib/crypto.js';
import { clearDb, startTestDb } from './helpers.js';

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

describe('GET /api/health', () => {
  it('reports ok when the database is connected', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });
});

describe('POST /api/meetings', () => {
  it('creates a meeting and returns the host key once', async () => {
    const res = await request(app).post('/api/meetings').send({ title: '  Standup  ' });

    expect(res.status).toBe(201);
    expect(res.body.meeting.code).toMatch(MEETING_CODE_REGEX);
    expect(res.body.meeting).toMatchObject({
      title: 'Standup',
      status: 'active',
      maxParticipants: 4,
      participantCount: 0,
    });
    expect(res.body.joinUrl).toBe(`http://localhost:5173/m/${res.body.meeting.code}`);
    expect(res.body.hostKey).toEqual(expect.any(String));
    expect(res.body.meeting).not.toHaveProperty('hostKeyHash');

    const stored = await Meeting.findOne({ code: res.body.meeting.code }).select('+hostKeyHash');
    expect(stored.hostKeyHash).toBe(sha256(res.body.hostKey));
  });

  it('generates a different code for every meeting', async () => {
    const codes = new Set();
    for (let i = 0; i < 20; i++) {
      const res = await request(app).post('/api/meetings').send({});
      codes.add(res.body.meeting.code);
    }
    expect(codes.size).toBe(20);
  });

  it('allows an empty body', async () => {
    const res = await request(app).post('/api/meetings');
    expect(res.status).toBe(201);
    expect(res.body.meeting.title).toBe('');
  });

  it('rejects a title that is too long with a validation error', async () => {
    const res = await request(app).post('/api/meetings').send({ title: 'x'.repeat(81) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ location: 'body', path: 'title' }),
    ]);
  });

  it('rejects unknown fields', async () => {
    const res = await request(app).post('/api/meetings').send({ title: 'ok', isAdmin: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed JSON with a consistent error shape', async () => {
    const res = await request(app)
      .post('/api/meetings')
      .set('Content-Type', 'application/json')
      .send('{"title":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' },
    });
  });
});

describe('GET /api/meetings/:code', () => {
  it('returns public meeting details', async () => {
    const created = await request(app).post('/api/meetings').send({ title: 'Demo' });
    const { code } = created.body.meeting;

    const res = await request(app).get(`/api/meetings/${code}`);
    expect(res.status).toBe(200);
    expect(res.body.meeting).toMatchObject({ code, title: 'Demo', status: 'active', participantCount: 0 });
  });

  it('normalizes upper-case codes', async () => {
    const created = await request(app).post('/api/meetings').send({});
    const { code } = created.body.meeting;

    const res = await request(app).get(`/api/meetings/${code.toUpperCase()}`);
    expect(res.status).toBe(200);
    expect(res.body.meeting.code).toBe(code);
  });

  it('marks a meeting that has been idle too long as expired', async () => {
    const created = await request(app).post('/api/meetings').send({});
    const { code } = created.body.meeting;
    await Meeting.updateOne({ code }, { lastActiveAt: new Date(Date.now() - MEETING_IDLE_TTL_MS - 1000) });

    const res = await request(app).get(`/api/meetings/${code}`);
    expect(res.status).toBe(200);
    expect(res.body.meeting).toMatchObject({ status: 'ended', endedReason: 'expired' });

    const stored = await Meeting.findOne({ code });
    expect(stored.expiresAt).toBeInstanceOf(Date);
  });

  it('returns 400 for a malformed code', async () => {
    const res = await request(app).get('/api/meetings/not-a-code');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for an unknown code', async () => {
    const res = await request(app).get('/api/meetings/aaa-bbbb-ccc');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Meeting not found' } });
  });
});

describe('unknown routes', () => {
  it('return a JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
