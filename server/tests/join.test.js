import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { RoomManager } from '../src/realtime/roomManager.js';
import { Meeting, MEETING_IDLE_TTL_MS } from '../src/modules/meetings/meeting.model.js';
import { Participant } from '../src/modules/meetings/participant.model.js';
import { verifyParticipantToken } from '../src/lib/tokens.js';
import { clearDb, startTestDb } from './helpers.js';

let stopDb;
let rooms;
let app;

beforeAll(async () => {
  stopDb = await startTestDb();
});

afterAll(async () => {
  await stopDb?.();
});

beforeEach(async () => {
  await clearDb();
  rooms = new RoomManager();
  app = createApp({ rooms });
});

async function createMeeting(title = 'Test') {
  const res = await request(app).post('/api/meetings').send({ title });
  return res.body; // { meeting, joinUrl, hostKey }
}

function join(code, body) {
  return request(app).post(`/api/meetings/${code}/join`).send(body);
}

describe('POST /api/meetings/:code/join', () => {
  it('lets a guest join with a display name and returns a scoped token', async () => {
    const { meeting } = await createMeeting();

    const res = await join(meeting.code, { displayName: '  Ada  ' });

    expect(res.status).toBe(200);
    expect(res.body.participant).toMatchObject({ displayName: 'Ada', role: 'guest' });
    expect(res.body.rtcConfig).toEqual({
      iceServers: [{ urls: expect.arrayContaining([expect.stringMatching(/^stun:/)]) }],
      iceTransportPolicy: 'all',
    });
    expect(res.body.meeting.code).toBe(meeting.code);

    const claims = verifyParticipantToken(res.body.token);
    expect(claims).toMatchObject({
      participantId: res.body.participant.id,
      code: meeting.code,
      role: 'guest',
      displayName: 'Ada',
    });

    const stored = await Participant.findById(res.body.participant.id);
    expect(stored).toMatchObject({ displayName: 'Ada', role: 'guest', leftAt: null });
  });

  it('gives the host role to whoever presents the correct host key', async () => {
    const { meeting, hostKey } = await createMeeting();
    const res = await join(meeting.code, { displayName: 'Host', hostKey });
    expect(res.status).toBe(200);
    expect(res.body.participant.role).toBe('host');
  });

  it('rejects a wrong host key instead of silently downgrading to guest', async () => {
    const { meeting } = await createMeeting();
    const res = await join(meeting.code, { displayName: 'Mallory', hostKey: 'guessed-key' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INVALID_HOST_KEY');
  });

  it.each([
    [{}, 'displayName'],
    [{ displayName: '   ' }, 'displayName'],
    [{ displayName: 'x'.repeat(41) }, 'displayName'],
    [{ displayName: 'Ad​min' }, 'displayName'], // zero-width space
    [{ displayName: 'Ada', role: 'host' }, ''], // unknown field
  ])('rejects invalid body %j', async (body, path) => {
    const { meeting } = await createMeeting();
    const res = await join(meeting.code, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0]).toMatchObject({ location: 'body', path });
  });

  it('returns 400 for a malformed meeting code', async () => {
    const res = await join('bad-code', { displayName: 'Ada' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ location: 'params', path: 'code' });
  });

  it('returns 404 for a meeting that does not exist', async () => {
    const res = await join('aaa-bbbb-ccc', { displayName: 'Ada' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 410 for a meeting the host ended', async () => {
    const { meeting } = await createMeeting();
    await Meeting.updateOne({ code: meeting.code }, { status: 'ended', endedReason: 'host_ended' });

    const res = await join(meeting.code, { displayName: 'Ada' });
    expect(res.status).toBe(410);
    expect(res.body.error).toEqual({ code: 'MEETING_ENDED', message: 'This meeting has ended' });
  });

  it('returns 410 for an expired (long idle) meeting link', async () => {
    const { meeting } = await createMeeting();
    await Meeting.updateOne(
      { code: meeting.code },
      { lastActiveAt: new Date(Date.now() - MEETING_IDLE_TTL_MS - 1000) },
    );

    const res = await join(meeting.code, { displayName: 'Ada' });
    expect(res.status).toBe(410);
    expect(res.body.error).toEqual({ code: 'MEETING_ENDED', message: 'This meeting link has expired' });
  });

  it('returns 409 when the room is already full', async () => {
    const { meeting } = await createMeeting();
    for (let i = 0; i < 4; i++) {
      rooms.add(meeting.code, { participantId: `p${i}`, displayName: `P${i}`, role: 'guest', socketId: `s${i}` });
    }

    const res = await join(meeting.code, { displayName: 'Fifth' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROOM_FULL');
  });
});

describe('POST /api/meetings/:code/end', () => {
  it('lets the host end the meeting', async () => {
    const { meeting, hostKey } = await createMeeting();
    const { body } = await join(meeting.code, { displayName: 'Host', hostKey });

    const res = await request(app)
      .post(`/api/meetings/${meeting.code}/end`)
      .set('Authorization', `Bearer ${body.token}`);
    expect(res.status).toBe(204);

    const lookup = await request(app).get(`/api/meetings/${meeting.code}`);
    expect(lookup.body.meeting).toMatchObject({ status: 'ended', endedReason: 'host_ended' });
  });

  it('forbids guests from ending the meeting', async () => {
    const { meeting } = await createMeeting();
    const { body } = await join(meeting.code, { displayName: 'Guest' });

    const res = await request(app)
      .post(`/api/meetings/${meeting.code}/end`)
      .set('Authorization', `Bearer ${body.token}`);
    expect(res.status).toBe(403);
  });

  it('rejects a host token from a different meeting', async () => {
    const a = await createMeeting('A');
    const b = await createMeeting('B');
    const { body } = await join(a.meeting.code, { displayName: 'Host A', hostKey: a.hostKey });

    const res = await request(app)
      .post(`/api/meetings/${b.meeting.code}/end`)
      .set('Authorization', `Bearer ${body.token}`);
    expect(res.status).toBe(403);
  });

  it('rejects missing, forged and expired tokens', async () => {
    const { meeting } = await createMeeting();
    const url = `/api/meetings/${meeting.code}/end`;

    const missing = await request(app).post(url);
    expect(missing.status).toBe(401);

    const forged = jwt.sign({ code: meeting.code, role: 'host' }, 'not-the-server-secret-but-long-enough!!');
    const forgedRes = await request(app).post(url).set('Authorization', `Bearer ${forged}`);
    expect(forgedRes.status).toBe(401);

    const expired = jwt.sign(
      { code: meeting.code, role: 'host', exp: Math.floor(Date.now() / 1000) - 10 },
      process.env.JWT_SECRET,
      { audience: 'confer:participant', subject: 'x' },
    );
    const expiredRes = await request(app).post(url).set('Authorization', `Bearer ${expired}`);
    expect(expiredRes.status).toBe(401);
    expect(expiredRes.body.error.code).toBe('TOKEN_EXPIRED');
  });
});
