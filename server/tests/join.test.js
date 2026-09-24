import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { RoomManager } from '../src/realtime/roomManager.js';
import { Meeting, MEETING_IDLE_TTL_MS } from '../src/modules/meetings/meeting.model.js';
import { Participant } from '../src/modules/meetings/participant.model.js';
import { verifyParticipantToken } from '../src/lib/tokens.js';
import { clearDb, createMeetingAs, signUp, startTestDb } from './helpers.js';

let stopDb;
let rooms;
let app;
let owner; // signed-in agent who creates meetings
let other; // a different signed-in user

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
  owner = await signUp(app, { name: 'Owner' });
  other = await signUp(app, { name: 'Member' });
});

const joinAs = (agent, code, displayName = 'Someone') =>
  (agent ?? request(app)).post(`/api/meetings/${code}/join`).send({ displayName });

describe('POST /api/meetings/:code/join — roles', () => {
  it('makes the owner the host, other signed-in users members, and everyone else guests', async () => {
    const { code } = await createMeetingAs(owner);

    const host = await joinAs(owner, code, 'Owner');
    const member = await joinAs(other, code, 'Member');
    const guest = await joinAs(null, code, 'Guest');

    expect(host.body.participant.role).toBe('host');
    expect(member.body.participant.role).toBe('member');
    expect(guest.body.participant.role).toBe('guest');
    expect(verifyParticipantToken(guest.body.token)).toMatchObject({ role: 'guest', code });
    expect(host.body.admission).toBe('admitted');
  });

  it('ignores any attempt to pick a role or host key in the body', async () => {
    const { code } = await createMeetingAs(owner);
    const res = await request(app).post(`/api/meetings/${code}/join`).send({ displayName: 'X', role: 'host' });
    expect(res.status).toBe(400);
    const res2 = await request(app).post(`/api/meetings/${code}/join`).send({ displayName: 'X', hostKey: 'anything' });
    expect(res2.status).toBe(400);
  });

  it('records the signed-in user on the participant (for history and bans)', async () => {
    const { code } = await createMeetingAs(owner);
    const res = await joinAs(other, code);
    const stored = await Participant.findById(res.body.participant.id);
    expect(stored.userId.toString()).toBe(other.user.id);
    expect(res.body.rtcConfig.iceServers[0].urls[0]).toMatch(/^stun:/);
  });
});

describe('POST /api/meetings/:code/join — host settings', () => {
  it('requires sign-in when the host disallows guests', async () => {
    const { code } = await createMeetingAs(owner, { settings: { allowGuests: false } });

    const guest = await joinAs(null, code);
    expect(guest.status).toBe(401);
    expect(guest.body.error.code).toBe('SIGN_IN_REQUIRED');

    expect((await joinAs(other, code)).status).toBe(200);
  });

  it('puts everyone but the host in the waiting room when it is on', async () => {
    const { code } = await createMeetingAs(owner, { settings: { waitingRoom: true } });

    expect((await joinAs(null, code)).body.admission).toBe('waiting');
    expect((await joinAs(other, code)).body.admission).toBe('waiting');
    expect((await joinAs(owner, code)).body.admission).toBe('admitted');
  });

  it('blocks new joins when locked, except the host', async () => {
    const { code } = await createMeetingAs(owner);
    await Meeting.updateOne({ code }, { 'settings.locked': true });

    for (const agent of [null, other]) {
      const res = await joinAs(agent, code);
      expect(res.status).toBe(423);
      expect(res.body.error.code).toBe('MEETING_LOCKED');
    }
    expect((await joinAs(owner, code)).status).toBe(200);
  });

  it('refuses signed-in users the host removed', async () => {
    const { code } = await createMeetingAs(owner);
    await Meeting.updateOne({ code }, { $addToSet: { bannedUserIds: other.user.id } });

    const res = await joinAs(other, code);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('REMOVED_FROM_MEETING');
  });

  it('keeps one seat for the host while they are not in the room', async () => {
    const { code } = await createMeetingAs(owner);
    for (let i = 0; i < 3; i++) {
      rooms.add(code, { participantId: `p${i}`, displayName: `P${i}`, role: 'guest', socketId: `s${i}` });
    }

    const fourthGuest = await joinAs(null, code);
    expect(fourthGuest.status).toBe(409);
    expect(fourthGuest.body.error.code).toBe('ROOM_FULL');
    expect((await joinAs(owner, code)).status).toBe(200);
  });

  it('returns 410 for ended and expired meetings, 404 for unknown, 400 for malformed', async () => {
    const ended = await createMeetingAs(owner);
    await Meeting.updateOne({ code: ended.code }, { status: 'ended', endedReason: 'host_ended' });
    expect((await joinAs(null, ended.code)).body.error).toEqual({ code: 'MEETING_ENDED', message: 'This meeting has ended' });

    const idle = await createMeetingAs(owner);
    await Meeting.updateOne({ code: idle.code }, { lastActiveAt: new Date(Date.now() - MEETING_IDLE_TTL_MS - 1000) });
    expect((await joinAs(null, idle.code)).body.error.message).toBe('This meeting link has expired');

    expect((await joinAs(null, 'aaa-bbbb-ccc')).status).toBe(404);
    expect((await joinAs(null, 'bad-code')).status).toBe(400);
  });

  it.each([
    [{}, 'displayName'],
    [{ displayName: '   ' }, 'displayName'],
    [{ displayName: 'x'.repeat(41) }, 'displayName'],
    [{ displayName: 'Ad​min' }, 'displayName'], // zero-width space
  ])('validates the display name %j', async (body, path) => {
    const { code } = await createMeetingAs(owner);
    const res = await request(app).post(`/api/meetings/${code}/join`).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ location: 'body', path });
  });
});

describe('POST /api/meetings/:code/end — permission meeting.end', () => {
  const end = (code, token) => {
    const req = request(app).post(`/api/meetings/${code}/end`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('lets the host end the meeting', async () => {
    const { code } = await createMeetingAs(owner);
    const { body } = await joinAs(owner, code);
    expect((await end(code, body.token)).status).toBe(204);
    expect((await Meeting.findOne({ code })).status).toBe('ended');
  });

  it('forbids members and guests', async () => {
    const { code } = await createMeetingAs(owner);
    for (const agent of [other, null]) {
      const { body } = await joinAs(agent, code);
      const res = await end(code, body.token);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect((await Meeting.findOne({ code })).status).toBe('active');
  });

  it('does not accept the owner’s session cookie in place of a participant token', async () => {
    const { code } = await createMeetingAs(owner);
    expect((await owner.post(`/api/meetings/${code}/end`)).status).toBe(401);
  });

  it('rejects a host token from a different meeting, and forged/expired tokens', async () => {
    const a = await createMeetingAs(owner);
    const b = await createMeetingAs(owner);
    const { body } = await joinAs(owner, a.code);
    expect((await end(b.code, body.token)).status).toBe(403);

    const forged = jwt.sign({ code: b.code, role: 'host' }, 'not-the-server-secret-but-long-enough!!', {
      audience: 'confer:participant',
      subject: '000000000000000000000000',
    });
    expect((await end(b.code, forged)).status).toBe(401);

    const expired = jwt.sign(
      { code: b.code, role: 'host', exp: Math.floor(Date.now() / 1000) - 10 },
      process.env.JWT_SECRET,
      { audience: 'confer:participant', subject: 'x' },
    );
    const res = await end(b.code, expired);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });
});

describe('GET /api/me/meetings — history', () => {
  it('lists meetings I host and meetings I entered while signed in, only mine', async () => {
    const hosted = await createMeetingAs(owner, { title: 'Hosted by owner' });
    const attended = await createMeetingAs(other, { title: 'Owner attended' });
    const notMine = await createMeetingAs(other, { title: 'Owner never joined' });

    const join = await joinAs(owner, attended.code);
    // "Attended" means actually entered the room, not just requested a token.
    await Participant.updateOne({ _id: join.body.participant.id }, { enteredAt: new Date() });
    await joinAs(owner, notMine.code); // token only, never entered

    const res = await owner.get('/api/me/meetings');
    expect(res.status).toBe(200);
    expect(res.body.meetings.map((m) => [m.title, m.role])).toEqual([
      ['Owner attended', 'member'],
      ['Hosted by owner', 'host'],
    ]);
    expect(res.body.meetings[0].attendeeCount).toBe(1);
    expect(hosted.code).toBeDefined();
  });

  it('requires sign-in', async () => {
    const res = await request(app).get('/api/me/meetings');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });
});
