import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Meeting, MEETING_IDLE_TTL_MS } from '../src/modules/meetings/meeting.model.js';
import { MEETING_CODE_REGEX } from '../src/lib/crypto.js';
import { clearDb, signUp, startTestDb } from './helpers.js';

let stopDb;
let app;
let host; // signed-in agent

beforeAll(async () => {
  stopDb = await startTestDb();
  app = createApp();
});

afterAll(async () => {
  await stopDb?.();
});

beforeEach(async () => {
  await clearDb();
  host = await signUp(app, { name: 'Ada Host' });
});

describe('GET /api/health', () => {
  it('reports ok when the database is connected', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });
});

describe('POST /api/meetings', () => {
  it('requires a signed-in user', async () => {
    const res = await request(app).post('/api/meetings').send({ title: 'Nope' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
    expect(await Meeting.countDocuments()).toBe(0);
  });

  it('creates a meeting owned by the signed-in user, with default settings', async () => {
    const res = await host.post('/api/meetings').send({ title: '  Standup  ' });

    expect(res.status).toBe(201);
    expect(res.body.meeting.code).toMatch(MEETING_CODE_REGEX);
    expect(res.body.meeting).toMatchObject({
      title: 'Standup',
      hostName: 'Ada Host',
      status: 'active',
      maxParticipants: 4,
      participantCount: 0,
      viewerIsHost: true,
      settings: { allowGuests: true, waitingRoom: false, locked: false },
    });
    expect(res.body.joinUrl).toBe(`http://localhost:5173/m/${res.body.meeting.code}`);

    const stored = await Meeting.findOne({ code: res.body.meeting.code });
    expect(stored.hostUserId.toString()).toBe(host.user.id);
  });

  it('accepts guest and waiting-room settings at creation', async () => {
    const res = await host.post('/api/meetings').send({ settings: { allowGuests: false, waitingRoom: true } });
    expect(res.body.meeting.settings).toEqual({ allowGuests: false, waitingRoom: true, locked: false });
  });

  it('does not let the creator lock the meeting or pick other fields at creation', async () => {
    const res = await host.post('/api/meetings').send({ settings: { locked: true } });
    expect(res.status).toBe(400);
    const res2 = await host.post('/api/meetings').send({ hostUserId: '000000000000000000000000' });
    expect(res2.status).toBe(400);
  });

  it('generates a different code for every meeting', async () => {
    const codes = new Set();
    for (let i = 0; i < 20; i++) {
      const res = await host.post('/api/meetings').send({});
      codes.add(res.body.meeting.code);
    }
    expect(codes.size).toBe(20);
  });

  it('rejects a title that is too long with a validation error', async () => {
    const res = await host.post('/api/meetings').send({ title: 'x'.repeat(81) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([expect.objectContaining({ location: 'body', path: 'title' })]);
  });

  it('rejects malformed JSON with a consistent error shape', async () => {
    const res = await host.post('/api/meetings').set('Content-Type', 'application/json').send('{"title":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  });
});

describe('GET /api/meetings/:code', () => {
  it('returns public meeting details to anyone, and tells the owner they are the host', async () => {
    const created = await host.post('/api/meetings').send({ title: 'Demo' });
    const { code } = created.body.meeting;

    const asGuest = await request(app).get(`/api/meetings/${code}`);
    expect(asGuest.status).toBe(200);
    expect(asGuest.body.meeting).toMatchObject({ code, title: 'Demo', hostName: 'Ada Host', viewerIsHost: false });
    expect(asGuest.body.meeting).not.toHaveProperty('hostUserId');
    expect(asGuest.body.meeting).not.toHaveProperty('bannedUserIds');

    const asHost = await host.get(`/api/meetings/${code}`);
    expect(asHost.body.meeting.viewerIsHost).toBe(true);
  });

  it('normalizes upper-case codes', async () => {
    const { code } = (await host.post('/api/meetings').send({})).body.meeting;
    const res = await request(app).get(`/api/meetings/${code.toUpperCase()}`);
    expect(res.status).toBe(200);
    expect(res.body.meeting.code).toBe(code);
  });

  it('marks a meeting that has been idle too long as expired', async () => {
    const { code } = (await host.post('/api/meetings').send({})).body.meeting;
    await Meeting.updateOne({ code }, { lastActiveAt: new Date(Date.now() - MEETING_IDLE_TTL_MS - 1000) });

    const res = await request(app).get(`/api/meetings/${code}`);
    expect(res.body.meeting).toMatchObject({ status: 'ended', endedReason: 'expired' });
    expect((await Meeting.findOne({ code })).expiresAt).toBeInstanceOf(Date);
  });

  it('returns 400 for a malformed code and 404 for an unknown one', async () => {
    expect((await request(app).get('/api/meetings/not-a-code')).status).toBe(400);
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
