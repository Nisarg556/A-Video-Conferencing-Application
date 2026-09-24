import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Participant } from '../src/modules/meetings/participant.model.js';
import {
  clearDb,
  connectSocket,
  createMeetingAs,
  emitWithAck,
  signUp,
  nextEvent,
  startTestDb,
  startTestServer,
} from './helpers.js';

let stopDb;
let server;
let sockets = [];

beforeAll(async () => {
  stopDb = await startTestDb();
  server = await startTestServer();
});

afterAll(async () => {
  await server?.close();
  await stopDb?.();
});

beforeEach(clearDb);

afterEach(() => {
  sockets.forEach((s) => s.close());
  sockets = [];
});

async function createMeeting() {
  const owner = await signUp(server.app, { name: 'Owner' });
  return { meeting: await createMeetingAs(owner, { title: 'Presence' }), owner };
}

/** agent: a signed-in supertest agent (the owner joins as host); omit for a guest. */
async function joinAndConnect(code, displayName, agent) {
  const res = await (agent ?? request(server.app)).post(`/api/meetings/${code}/join`).send({ displayName });
  const socket = await connectSocket(server.url, res.body.token);
  sockets.push(socket);
  return { socket, participant: res.body.participant, token: res.body.token };
}

describe('Socket.IO presence', () => {
  it('rejects connections without a valid token', async () => {
    await expect(connectSocket(server.url, 'garbage')).rejects.toMatchObject({
      data: { code: 'UNAUTHORIZED' },
    });
  });

  it('returns existing peers on join and notifies others', async () => {
    const { meeting, owner } = await createMeeting();
    const host = await joinAndConnect(meeting.code, 'Host', owner);
    const hostAck = await emitWithAck(host.socket, 'room:join');
    expect(hostAck).toMatchObject({ ok: true, self: { displayName: 'Host', role: 'host' }, peers: [] });

    const guest = await joinAndConnect(meeting.code, 'Guest');
    const announced = nextEvent(host.socket, 'peer:joined');
    const guestAck = await emitWithAck(guest.socket, 'room:join');

    expect(guestAck.peers).toEqual([expect.objectContaining({ displayName: 'Host' })]);
    expect(await announced).toMatchObject({ participantId: guest.participant.id, displayName: 'Guest' });
    expect(server.rooms.count(meeting.code)).toBe(2);

    const lookup = await request(server.app).get(`/api/meetings/${meeting.code}`);
    expect(lookup.body.meeting.participantCount).toBe(2);
  });

  it('announces leaves and records leftAt', async () => {
    const { meeting } = await createMeeting();
    const a = await joinAndConnect(meeting.code, 'A');
    const b = await joinAndConnect(meeting.code, 'B');
    await emitWithAck(a.socket, 'room:join');
    await emitWithAck(b.socket, 'room:join');

    const left = nextEvent(a.socket, 'peer:left');
    await emitWithAck(b.socket, 'room:leave');

    expect(await left).toEqual({ participantId: b.participant.id });
    expect(server.rooms.count(meeting.code)).toBe(1);
    await expect.poll(async () => (await Participant.findById(b.participant.id)).leftAt).toBeInstanceOf(Date);
  });

  it('treats closing the tab (socket disconnect) as leaving', async () => {
    const { meeting } = await createMeeting();
    const a = await joinAndConnect(meeting.code, 'A');
    const b = await joinAndConnect(meeting.code, 'B');
    await emitWithAck(a.socket, 'room:join');
    await emitWithAck(b.socket, 'room:join');

    const left = nextEvent(a.socket, 'peer:left');
    b.socket.close();
    expect(await left).toEqual({ participantId: b.participant.id });
  });

  it('enforces capacity on the socket even if the REST check was passed', async () => {
    const { meeting, owner } = await createMeeting();
    const host = await joinAndConnect(meeting.code, 'Host', owner);
    expect((await emitWithAck(host.socket, 'room:join')).ok).toBe(true);

    // Four guests all get tokens while there are still free seats...
    const guests = [];
    for (let i = 0; i < 4; i++) guests.push(await joinAndConnect(meeting.code, `P${i}`));

    // ...but only three fit next to the host (max 4).
    const acks = [];
    for (const g of guests) acks.push(await emitWithAck(g.socket, 'room:join'));
    expect(acks.slice(0, 3).every((a) => a.ok)).toBe(true);
    expect(acks[3]).toEqual({ ok: false, error: { code: 'ROOM_FULL', message: expect.any(String) } });
  });

  it('keeps a seat free for the host even when guests arrive first', async () => {
    const { meeting, owner } = await createMeeting();
    const guests = [];
    for (let i = 0; i < 4; i++) guests.push(await joinAndConnect(meeting.code, `G${i}`));
    const acks = [];
    for (const g of guests) acks.push(await emitWithAck(g.socket, 'room:join'));
    expect(acks.map((a) => a.ok ?? false)).toEqual([true, true, true, false]);

    const host = await joinAndConnect(meeting.code, 'Host', owner);
    expect((await emitWithAck(host.socket, 'room:join')).ok).toBe(true);
  });

  it('replaces the old connection when the same participant reconnects', async () => {
    const { meeting } = await createMeeting();
    const a = await joinAndConnect(meeting.code, 'A');
    const b = await joinAndConnect(meeting.code, 'B');
    await emitWithAck(a.socket, 'room:join');
    await emitWithAck(b.socket, 'room:join');

    let sawLeave = false;
    a.socket.on('peer:left', () => (sawLeave = true));
    const replaced = nextEvent(b.socket, 'session:replaced');

    const bAgain = await connectSocket(server.url, b.token);
    sockets.push(bAgain);
    const ack = await emitWithAck(bAgain, 'room:join');

    await replaced;
    expect(ack.ok).toBe(true);
    expect(server.rooms.count(meeting.code)).toBe(2);
    expect(sawLeave).toBe(false);
  });

  it('disconnects everyone when the host ends the meeting', async () => {
    const { meeting, owner } = await createMeeting();
    const host = await joinAndConnect(meeting.code, 'Host', owner);
    const guest = await joinAndConnect(meeting.code, 'Guest');
    await emitWithAck(host.socket, 'room:join');
    await emitWithAck(guest.socket, 'room:join');

    const ended = nextEvent(guest.socket, 'meeting:ended');
    const res = await request(server.app)
      .post(`/api/meetings/${meeting.code}/end`)
      .set('Authorization', `Bearer ${host.token}`);

    expect(res.status).toBe(204);
    expect(await ended).toEqual({ reason: 'host_ended' });
    expect(server.rooms.count(meeting.code)).toBe(0);

    // A token issued before the meeting ended can't get back in.
    const late = await connectSocket(server.url, guest.token);
    sockets.push(late);
    const ack = await emitWithAck(late, 'room:join');
    expect(ack.error.code).toBe('MEETING_ENDED');
  });
});
