import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Message } from '../src/modules/chat/message.model.js';
import { clearDb, connectSocket, emitWithAck, startTestDb, startTestServer } from './helpers.js';

let stopDb;
let server;
let sockets = [];
let msgCounter = 0;

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

const newClientMsgId = () => `msg-${Date.now()}-${++msgCounter}`;

async function createMeeting() {
  const res = await request(server.app).post('/api/meetings').send({});
  return { code: res.body.meeting.code, hostKey: res.body.hostKey };
}

async function enter(code, displayName, { hostKey, join = true } = {}) {
  const res = await request(server.app).post(`/api/meetings/${code}/join`).send({ displayName, hostKey });
  const socket = await connectSocket(server.url, res.body.token);
  sockets.push(socket);
  if (join) await emitWithAck(socket, 'room:join', {});
  return { socket, id: res.body.participant.id, token: res.body.token };
}

function send(socket, text, clientMsgId = newClientMsgId()) {
  return emitWithAck(socket, 'chat:send', { text, clientMsgId });
}

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

function history(code, token, query = '') {
  const req = request(server.app).get(`/api/meetings/${code}/messages${query}`);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
}

describe('chat:send', () => {
  it('stores the message, acks the sender and delivers it to others in the meeting', async () => {
    const { code } = await createMeeting();
    const ada = await enter(code, 'Ada');
    const bo = await enter(code, 'Bo');

    const incoming = eventOrNull(bo.socket, 'chat:message', 1000);
    const echoToSender = eventOrNull(ada.socket, 'chat:message');
    const ack = await send(ada.socket, '  Hello\r\nworld  ');

    expect(ack).toEqual({
      ok: true,
      message: {
        id: expect.any(String),
        participantId: ada.id,
        senderName: 'Ada',
        text: 'Hello\nworld', // trimmed, newline normalized
        clientMsgId: expect.any(String),
        createdAt: expect.any(String),
      },
    });
    expect(await incoming).toEqual(ack.message);
    expect(await echoToSender).toBeNull(); // sender uses the ack, no duplicate event
  });

  it('never delivers messages to another meeting', async () => {
    const one = await createMeeting();
    const two = await createMeeting();
    const ada = await enter(one.code, 'Ada');
    const eve = await enter(two.code, 'Eve');

    const leaked = eventOrNull(eve.socket, 'chat:message');
    await send(ada.socket, 'secret');
    expect(await leaked).toBeNull();

    const eveHistory = await history(two.code, eve.token);
    expect(eveHistory.body.messages).toEqual([]);
  });

  it('rejects messages from a socket that has not joined the room', async () => {
    const { code } = await createMeeting();
    const lurker = await enter(code, 'Lurker', { join: false });

    const ack = await send(lurker.socket, 'hi');
    expect(ack).toEqual({ ok: false, error: { code: 'NOT_IN_MEETING', message: expect.any(String) } });
    expect(await Message.countDocuments()).toBe(0);
  });

  it.each([
    ['empty', '   \n  ', 'Message is empty'],
    ['too long', 'x'.repeat(1001), 'Messages can be at most 1000 characters'],
    ['bidi override', 'click ‮gnp.exe', 'Message contains invalid characters'],
    ['control character', 'bell\u0007', 'Message contains invalid characters'],
  ])('rejects %s messages', async (_label, text, message) => {
    const { code } = await createMeeting();
    const ada = await enter(code, 'Ada');
    expect(await send(ada.socket, text)).toEqual({ ok: false, error: { code: 'VALIDATION_ERROR', message } });
  });

  it('allows emoji, including joined sequences', async () => {
    const { code } = await createMeeting();
    const ada = await enter(code, 'Ada');
    const ack = await send(ada.socket, 'family: 👨‍👩‍👧 thumbs: 👍🏽');
    expect(ack.ok).toBe(true);
  });

  it('stores text as-is; escaping is the renderer’s job', async () => {
    const { code } = await createMeeting();
    const ada = await enter(code, 'Ada');
    const ack = await send(ada.socket, '<img src=x onerror=alert(1)>');
    expect(ack.message.text).toBe('<img src=x onerror=alert(1)>');
  });

  it('does not duplicate a retried message (same clientMsgId)', async () => {
    const { code } = await createMeeting();
    const ada = await enter(code, 'Ada');
    const bo = await enter(code, 'Bo');

    let deliveries = 0;
    bo.socket.on('chat:message', () => deliveries++);
    const first = await send(ada.socket, 'once', 'retry-id-123');
    const retry = await send(ada.socket, 'once', 'retry-id-123');

    expect(retry.message.id).toBe(first.message.id);
    expect(await Message.countDocuments()).toBe(1);
    await new Promise((r) => setTimeout(r, 200));
    expect(deliveries).toBe(1);
  });

  it('rate-limits a participant who floods the chat', async () => {
    const { code } = await createMeeting();
    const ada = await enter(code, 'Ada');

    const acks = [];
    for (let i = 0; i < 6; i++) acks.push(await send(ada.socket, `msg ${i}`));

    expect(acks.slice(0, 5).every((a) => a.ok)).toBe(true);
    expect(acks[5].error.code).toBe('RATE_LIMITED');
  });
});

describe('GET /api/meetings/:code/messages', () => {
  it('returns the meeting’s history oldest-first for late joiners, with pagination', async () => {
    const { code } = await createMeeting();
    const ada = await enter(code, 'Ada');
    for (const text of ['one', 'two', 'three']) await send(ada.socket, text);

    const late = await enter(code, 'Late');
    const all = await history(code, late.token);
    expect(all.status).toBe(200);
    expect(all.body.messages.map((m) => m.text)).toEqual(['one', 'two', 'three']);

    const lastTwo = await history(code, late.token, '?limit=2');
    expect(lastTwo.body.messages.map((m) => m.text)).toEqual(['two', 'three']);

    const older = await history(code, late.token, `?before=${encodeURIComponent(lastTwo.body.messages[0].createdAt)}`);
    expect(older.body.messages.map((m) => m.text)).toEqual(['one']);
  });

  it('requires a participant token for this meeting', async () => {
    const one = await createMeeting();
    const two = await createMeeting();
    const outsider = await enter(two.code, 'Outsider', { join: false });

    expect((await history(one.code)).status).toBe(401);
    expect((await history(one.code, outsider.token)).status).toBe(403);
  });

  it('validates query parameters', async () => {
    const { code } = await createMeeting();
    const ada = await enter(code, 'Ada', { join: false });
    const res = await history(code, ada.token, '?limit=1000');
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ location: 'query', path: 'limit' });
  });

  it('deletes all messages when the meeting ends, and history then returns 410', async () => {
    const { code, hostKey } = await createMeeting();
    const host = await enter(code, 'Host', { hostKey });
    await send(host.socket, 'bye');
    expect(await Message.countDocuments()).toBe(1);

    const end = await request(server.app)
      .post(`/api/meetings/${code}/end`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(end.status).toBe(204);

    expect(await Message.countDocuments()).toBe(0);
    const res = await history(code, host.token);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('MEETING_ENDED');
  });
});
