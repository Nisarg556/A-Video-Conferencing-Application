import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  clearDb,
  connectSocket,
  createMeetingAs,
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

async function createMeeting() {
  const host = await signUp(server.app, { name: 'Owner' });
  return (await createMeetingAs(host)).code;
}

async function enter(code, displayName, { join = true } = {}) {
  const res = await request(server.app).post(`/api/meetings/${code}/join`).send({ displayName });
  const socket = await connectSocket(server.url, res.body.token);
  sockets.push(socket);
  const ack = join ? await emitWithAck(socket, 'room:join', {}) : null;
  return { socket, id: res.body.participant.id, token: res.body.token, ack };
}

describe('screen share presenter slot', () => {
  it('announces the presenter to everyone else and includes it for late joiners', async () => {
    const code = await createMeeting();
    const ada = await enter(code, 'Ada');
    const bo = await enter(code, 'Bo');

    const announced = nextEvent(bo.socket, 'presenter:changed');
    expect(await emitWithAck(ada.socket, 'screen:start')).toEqual({ ok: true });
    expect(await announced).toEqual({ participantId: ada.id });

    const late = await enter(code, 'Late');
    expect(late.ack.presenterId).toBe(ada.id);
  });

  it('allows only one presenter at a time and says who is presenting', async () => {
    const code = await createMeeting();
    const ada = await enter(code, 'Ada');
    const bo = await enter(code, 'Bo');

    await emitWithAck(ada.socket, 'screen:start');
    const second = await emitWithAck(bo.socket, 'screen:start');

    expect(second).toEqual({ ok: false, error: { code: 'SCREEN_SHARE_BUSY', message: 'Ada is already presenting' } });
    expect(server.rooms.getPresenter(code)).toBe(ada.id);
  });

  it('frees the slot when the presenter stops (app button or browser "Stop sharing")', async () => {
    const code = await createMeeting();
    const ada = await enter(code, 'Ada');
    const bo = await enter(code, 'Bo');
    await emitWithAck(ada.socket, 'screen:start');

    const cleared = nextEvent(bo.socket, 'presenter:changed');
    ada.socket.emit('screen:stop');
    expect(await cleared).toEqual({ participantId: null });

    expect(await emitWithAck(bo.socket, 'screen:start')).toEqual({ ok: true });
  });

  it('ignores screen:stop from someone who is not presenting', async () => {
    const code = await createMeeting();
    const ada = await enter(code, 'Ada');
    const bo = await enter(code, 'Bo');
    await emitWithAck(ada.socket, 'screen:start');

    bo.socket.emit('screen:stop');
    await emitWithAck(bo.socket, 'room:join', {}); // round-trip so the stop was processed
    expect(server.rooms.getPresenter(code)).toBe(ada.id);
  });

  it('frees the slot and notifies others when the presenter closes their tab', async () => {
    const code = await createMeeting();
    const ada = await enter(code, 'Ada');
    const bo = await enter(code, 'Bo');
    await emitWithAck(ada.socket, 'screen:start');

    const cleared = nextEvent(bo.socket, 'presenter:changed');
    ada.socket.close();
    expect(await cleared).toEqual({ participantId: null });
    expect(server.rooms.getPresenter(code)).toBeNull();
  });

  it('keeps the presenter through a reconnect, and re-claiming is idempotent', async () => {
    const code = await createMeeting();
    const ada = await enter(code, 'Ada');
    const bo = await enter(code, 'Bo');
    await emitWithAck(ada.socket, 'screen:start');

    let changes = 0;
    bo.socket.on('presenter:changed', () => changes++);

    // Same participant reconnects on a new socket (network blip).
    const again = await connectSocket(server.url, ada.token);
    sockets.push(again);
    const ack = await emitWithAck(again, 'room:join', {});
    expect(ack.presenterId).toBe(ada.id);
    expect(await emitWithAck(again, 'screen:start')).toEqual({ ok: true });

    await new Promise((r) => setTimeout(r, 200));
    expect(changes).toBe(0);
  });

  it('rejects screen:start before joining the room', async () => {
    const code = await createMeeting();
    const lurker = await enter(code, 'Lurker', { join: false });
    const ack = await emitWithAck(lurker.socket, 'screen:start');
    expect(ack.error.code).toBe('NOT_IN_MEETING');
  });
});
