import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  clearDb,
  connectSocket,
  emitWithAck,
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

const OFFER = { type: 'offer', connectionId: 'conn-abc123', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n' };

async function createMeeting() {
  const res = await request(server.app).post('/api/meetings').send({});
  return res.body.meeting.code;
}

/** REST join + socket connect + room:join. */
async function enter(code, displayName, media = { audio: true, video: true }) {
  const res = await request(server.app).post(`/api/meetings/${code}/join`).send({ displayName });
  const socket = await connectSocket(server.url, res.body.token);
  sockets.push(socket);
  const ack = await emitWithAck(socket, 'room:join', { media });
  return { socket, id: res.body.participant.id, ack };
}

/** Resolves with the next `event`, or null if none arrives within `ms`. */
function eventOrNull(socket, event, ms = 300) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      resolve(null);
    }, ms);
    function onEvent(payload) {
      clearTimeout(timer);
      resolve(payload);
    }
    socket.once(event, onEvent);
  });
}

describe('signal relay', () => {
  it('delivers an offer only to its target, stamped with the real sender', async () => {
    const code = await createMeeting();
    const a = await enter(code, 'A');
    const b = await enter(code, 'B');
    const c = await enter(code, 'C');

    const received = nextEvent(a.socket, 'signal');
    const bystander = eventOrNull(c.socket, 'signal');
    // "from" is spoofed in the payload; the server must ignore it.
    b.socket.emit('signal', { ...OFFER, to: a.id, from: c.id });

    expect(await received).toEqual({ ...OFFER, from: b.id });
    expect(await bystander).toBeNull();
  });

  it('relays answers and ICE candidates back to the offerer', async () => {
    const code = await createMeeting();
    const a = await enter(code, 'A');
    const b = await enter(code, 'B');

    const answer = nextEvent(b.socket, 'signal');
    a.socket.emit('signal', { type: 'answer', to: b.id, connectionId: 'conn-abc123', sdp: 'v=0 answer' });
    expect(await answer).toMatchObject({ type: 'answer', from: a.id, connectionId: 'conn-abc123' });

    const candidate = { candidate: 'candidate:1 1 udp 2122260223 10.0.0.2 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 };
    const ice = nextEvent(b.socket, 'signal');
    a.socket.emit('signal', { type: 'candidate', to: b.id, connectionId: 'conn-abc123', candidate });
    expect(await ice).toEqual({ type: 'candidate', from: a.id, connectionId: 'conn-abc123', candidate });
  });

  it('never relays across meetings', async () => {
    const meetingA = await createMeeting();
    const meetingB = await createMeeting();
    const alice = await enter(meetingA, 'Alice');
    const mallory = await enter(meetingB, 'Mallory');

    const leaked = eventOrNull(alice.socket, 'signal');
    mallory.socket.emit('signal', { ...OFFER, to: alice.id });
    expect(await leaked).toBeNull();
  });

  it('ignores signals from sockets that have not joined the room', async () => {
    const code = await createMeeting();
    const a = await enter(code, 'A');
    const res = await request(server.app).post(`/api/meetings/${code}/join`).send({ displayName: 'Lurker' });
    const lurker = await connectSocket(server.url, res.body.token);
    sockets.push(lurker);

    const leaked = eventOrNull(a.socket, 'signal');
    lurker.emit('signal', { ...OFFER, to: a.id });
    expect(await leaked).toBeNull();
  });

  it.each([
    ['unknown type', { ...OFFER, type: 'hack' }],
    ['missing connectionId', { type: 'offer', sdp: 'v=0' }],
    ['oversized SDP', { ...OFFER, sdp: 'x'.repeat(64 * 1024 + 1) }],
    ['malformed target id', { ...OFFER, to: 'not-an-id' }],
  ])('drops invalid payloads (%s)', async (_label, payload) => {
    const code = await createMeeting();
    const a = await enter(code, 'A');
    const b = await enter(code, 'B');

    const leaked = eventOrNull(a.socket, 'signal');
    b.socket.emit('signal', { to: a.id, ...payload });
    expect(await leaked).toBeNull();
  });

  it('stops relaying when a socket floods signals', async () => {
    const code = await createMeeting();
    const a = await enter(code, 'A');
    const b = await enter(code, 'B');

    let delivered = 0;
    a.socket.on('signal', () => delivered++);
    for (let i = 0; i < 400; i++) b.socket.emit('signal', { ...OFFER, to: a.id });

    await expect.poll(() => delivered).toBe(300);
    await new Promise((r) => setTimeout(r, 200));
    expect(delivered).toBe(300);
  });
});

describe('media state', () => {
  it('includes each peer’s media state in the join snapshot and peer:joined', async () => {
    const code = await createMeeting();
    const a = await enter(code, 'A', { audio: true, video: false });

    const joined = nextEvent(a.socket, 'peer:joined');
    const b = await enter(code, 'B', { audio: false, video: true });

    expect(b.ack.peers[0].media).toEqual({ audio: true, video: false });
    expect((await joined).media).toEqual({ audio: false, video: true });
  });

  it('broadcasts toggles and remembers them for late joiners', async () => {
    const code = await createMeeting();
    const a = await enter(code, 'A');
    const b = await enter(code, 'B');

    const update = nextEvent(b.socket, 'peer:media');
    a.socket.emit('media:state', { audio: false, video: true });
    expect(await update).toEqual({ participantId: a.id, audio: false, video: true });

    const c = await enter(code, 'C');
    const seenA = c.ack.peers.find((p) => p.participantId === a.id);
    expect(seenA.media).toEqual({ audio: false, video: true });
  });

  it('ignores malformed media state', async () => {
    const code = await createMeeting();
    const a = await enter(code, 'A');
    const b = await enter(code, 'B');

    const update = eventOrNull(b.socket, 'peer:media');
    a.socket.emit('media:state', { audio: 'yes' });
    expect(await update).toBeNull();
  });
});

describe('disconnect cleanup', () => {
  it('tells remaining peers when someone closes their tab, so they can close the connection', async () => {
    const code = await createMeeting();
    const a = await enter(code, 'A');
    const b = await enter(code, 'B');

    const left = nextEvent(a.socket, 'peer:left');
    b.socket.close(); // what the browser does when the tab closes
    expect(await left).toEqual({ participantId: b.id });
    expect(server.rooms.get(code, b.id)).toBeUndefined();
  });

  it('drops signals addressed to someone who already left', async () => {
    const code = await createMeeting();
    const a = await enter(code, 'A');
    const b = await enter(code, 'B');
    const c = await enter(code, 'C');

    const left = nextEvent(a.socket, 'peer:left');
    b.socket.close();
    await left;

    // C still thinks B exists (race) and sends it a candidate: nobody gets it.
    const leakedToA = eventOrNull(a.socket, 'signal');
    c.socket.emit('signal', { ...OFFER, to: b.id });
    expect(await leakedToA).toBeNull();
  });
});
