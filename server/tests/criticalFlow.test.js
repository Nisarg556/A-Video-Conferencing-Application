import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  clearDb,
  connectSocket,
  emitWithAck,
  nextEvent,
  signUp,
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

async function connect(token) {
  const socket = await connectSocket(server.url, token);
  sockets.push(socket);
  return socket;
}

/**
 * The whole product in one story, through the real HTTP + Socket.IO server:
 * sign up → create (waiting room) → guest asks to join → host admits →
 * WebRTC offer/answer relayed → mute → screen share → chat → guest leaves →
 * host ends → history shows it ended and the chat is gone.
 */
describe('critical flow', () => {
  it('a host and a guest meet from start to finish', async () => {
    // 1. Host signs up and creates a meeting with a waiting room.
    const hostAgent = await signUp(server.app, { name: 'Hannah' });
    const created = await hostAgent.post('/api/meetings').send({ title: 'Demo', settings: { waitingRoom: true } });
    expect(created.status).toBe(201);
    const { code } = created.body.meeting;

    // 2. Host joins (never waits) and enters the room.
    const hostJoin = await hostAgent.post(`/api/meetings/${code}/join`).send({ displayName: 'Hannah' });
    expect(hostJoin.body).toMatchObject({ admission: 'admitted', participant: { role: 'host' } });
    const host = await connect(hostJoin.body.token);
    expect(await emitWithAck(host, 'room:join', { media: { audio: true, video: true } })).toMatchObject({
      ok: true,
      peers: [],
    });

    // 3. A guest opens the link: public details, then asks to join and waits.
    const lobby = await request(server.app).get(`/api/meetings/${code}`);
    expect(lobby.body.meeting).toMatchObject({ hostName: 'Hannah', settings: { waitingRoom: true } });
    const guestJoin = await request(server.app).post(`/api/meetings/${code}/join`).send({ displayName: 'Gus' });
    expect(guestJoin.body).toMatchObject({ admission: 'waiting', participant: { role: 'guest' } });
    const guestId = guestJoin.body.participant.id;
    const guest = await connect(guestJoin.body.token);
    const hostSeesLobby = nextEvent(host, 'lobby:updated');
    expect(await emitWithAck(guest, 'room:join', { media: { audio: true, video: false } })).toMatchObject({
      waiting: true,
    });
    expect((await hostSeesLobby).waiting[0].displayName).toBe('Gus');

    // 4. Host admits; the guest enters and the host is told.
    const admitted = nextEvent(guest, 'lobby:admitted');
    await emitWithAck(host, 'lobby:admit', { participantId: guestId });
    await admitted;
    const hostSeesGuest = nextEvent(host, 'peer:joined');
    const guestAck = await emitWithAck(guest, 'room:join', { media: { audio: true, video: false } });
    expect(guestAck.peers.map((p) => p.displayName)).toEqual(['Hannah']);
    expect((await hostSeesGuest).media).toEqual({ audio: true, video: false });

    // 5. The newcomer (guest) offers; the host answers; both relayed with verified senders.
    const hostGetsOffer = nextEvent(host, 'signal');
    guest.emit('signal', { to: hostJoin.body.participant.id, type: 'offer', connectionId: 'conn-00000001', sdp: 'v=0 offer' });
    expect(await hostGetsOffer).toMatchObject({ from: guestId, type: 'offer' });
    const guestGetsAnswer = nextEvent(guest, 'signal');
    host.emit('signal', { to: guestId, type: 'answer', connectionId: 'conn-00000001', sdp: 'v=0 answer' });
    expect(await guestGetsAnswer).toMatchObject({ from: hostJoin.body.participant.id, type: 'answer' });

    // 6. Guest mutes; host presents; both are broadcast.
    const muted = nextEvent(host, 'peer:media');
    guest.emit('media:state', { audio: false, video: false });
    expect(await muted).toEqual({ participantId: guestId, audio: false, video: false });
    const presenting = nextEvent(guest, 'presenter:changed');
    expect(await emitWithAck(host, 'screen:start')).toEqual({ ok: true });
    expect(await presenting).toEqual({ participantId: hostJoin.body.participant.id });

    // 7. Chat both ways, and history for the admitted guest.
    const guestGetsChat = nextEvent(guest, 'chat:message');
    await emitWithAck(host, 'chat:send', { text: 'Welcome!', clientMsgId: 'client-msg-1' });
    expect((await guestGetsChat).text).toBe('Welcome!');
    const history = await request(server.app)
      .get(`/api/meetings/${code}/messages`)
      .set('Authorization', `Bearer ${guestJoin.body.token}`);
    expect(history.body.messages.map((m) => m.text)).toEqual(['Welcome!']);

    // 8. Guest leaves.
    const guestLeft = nextEvent(host, 'peer:left');
    await emitWithAck(guest, 'room:leave');
    expect(await guestLeft).toEqual({ participantId: guestId });

    // 9. Host ends the meeting for everyone.
    const ended = nextEvent(host, 'meeting:ended');
    const end = await request(server.app).post(`/api/meetings/${code}/end`).set('Authorization', `Bearer ${hostJoin.body.token}`);
    expect(end.status).toBe(204);
    expect(await ended).toEqual({ reason: 'host_ended' });

    // 10. History shows the ended meeting with both attendees; chat is gone.
    const mine = await hostAgent.get('/api/me/meetings');
    expect(mine.body.meetings[0]).toMatchObject({ code, status: 'ended', role: 'host', attendeeCount: 2 });
    const afterEnd = await request(server.app)
      .get(`/api/meetings/${code}/messages`)
      .set('Authorization', `Bearer ${hostJoin.body.token}`);
    expect(afterEnd.status).toBe(410);
  });
});
