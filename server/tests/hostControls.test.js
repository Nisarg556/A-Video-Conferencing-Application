import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Meeting } from '../src/modules/meetings/meeting.model.js';
import { Participant } from '../src/modules/meetings/participant.model.js';
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
let owner;
let member;

beforeAll(async () => {
  stopDb = await startTestDb();
  server = await startTestServer();
});

afterAll(async () => {
  await server?.close();
  await stopDb?.();
});

beforeEach(async () => {
  await clearDb();
  owner = await signUp(server.app, { name: 'Owner' });
  member = await signUp(server.app, { name: 'Member' });
});

afterEach(() => {
  sockets.forEach((s) => s.close());
  sockets = [];
});

/** REST join (as `agent`, or a guest) + socket connect. Emits room:join unless join=false. */
async function enter(code, displayName, { agent, join = true } = {}) {
  const res = await (agent ?? request(server.app)).post(`/api/meetings/${code}/join`).send({ displayName });
  if (res.status !== 200) return { res };
  const socket = await connectSocket(server.url, res.body.token);
  sockets.push(socket);
  const ack = join ? await emitWithAck(socket, 'room:join', {}) : null;
  return { res, socket, ack, id: res.body.participant.id, token: res.body.token };
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

async function meetingWithHost(settings = {}) {
  const { code } = await createMeetingAs(owner, { settings });
  const host = await enter(code, 'Owner', { agent: owner });
  return { code, host };
}

describe('waiting room', () => {
  it('holds non-hosts in the lobby, where they can’t see or send meeting traffic', async () => {
    const { code, host } = await meetingWithHost({ waitingRoom: true });

    const lobbyUpdate = nextEvent(host.socket, 'lobby:updated');
    const guest = await enter(code, 'Waiting Wendy');
    expect(guest.res.body.admission).toBe('waiting');
    expect(guest.ack).toMatchObject({ ok: true, waiting: true });
    expect(await lobbyUpdate).toEqual({
      waiting: [expect.objectContaining({ participantId: guest.id, displayName: 'Waiting Wendy', role: 'guest' })],
    });
    expect(server.rooms.count(code)).toBe(1); // only the host is in the room

    // Nothing from the meeting reaches the lobby...
    const leakedChat = eventOrNull(guest.socket, 'chat:message');
    await emitWithAck(host.socket, 'chat:send', { text: 'secret agenda', clientMsgId: 'client-msg-1' });
    expect(await leakedChat).toBeNull();

    // ...and the lobby can't talk to the meeting.
    expect((await emitWithAck(guest.socket, 'chat:send', { text: 'hi', clientMsgId: 'client-msg-2' })).error.code).toBe(
      'NOT_IN_MEETING',
    );
    expect((await emitWithAck(guest.socket, 'screen:start')).error.code).toBe('NOT_IN_MEETING');
    const leakedSignal = eventOrNull(host.socket, 'signal');
    guest.socket.emit('signal', { to: host.id, type: 'offer', connectionId: 'conn-12345678', sdp: 'v=0' });
    expect(await leakedSignal).toBeNull();
  });

  it('shows the host everyone already waiting when they join', async () => {
    const { code } = await createMeetingAs(owner, { settings: { waitingRoom: true } });
    const guest = await enter(code, 'Early Eve');

    const host = await enter(code, 'Owner', { agent: owner });
    expect(host.ack.lobby).toEqual([expect.objectContaining({ participantId: guest.id, displayName: 'Early Eve' })]);
  });

  it('admits someone: they are told, re-join, and everyone sees them arrive', async () => {
    const { code, host } = await meetingWithHost({ waitingRoom: true });
    const guestArrived = nextEvent(host.socket, 'lobby:updated');
    const guest = await enter(code, 'Guest');
    await guestArrived; // sent after the guest's ack, so wait for it explicitly

    const admitted = nextEvent(guest.socket, 'lobby:admitted');
    const lobbyCleared = nextEvent(host.socket, 'lobby:updated');
    expect(await emitWithAck(host.socket, 'lobby:admit', { participantId: guest.id })).toEqual({ ok: true });
    await admitted;
    expect(await lobbyCleared).toEqual({ waiting: [] });

    const arrived = nextEvent(host.socket, 'peer:joined');
    const ack = await emitWithAck(guest.socket, 'room:join', {});
    expect(ack.ok).toBe(true);
    expect(ack.peers.map((p) => p.displayName)).toEqual(['Owner']);
    expect((await arrived).participantId).toBe(guest.id);
    expect((await Participant.findById(guest.id)).admittedBy).toBe('host');
  });

  it('denies someone: they are told and disconnected, and that token can never enter', async () => {
    const { code, host } = await meetingWithHost({ waitingRoom: true });
    const guest = await enter(code, 'Unwanted');

    const denied = nextEvent(guest.socket, 'lobby:denied');
    const disconnected = nextEvent(guest.socket, 'disconnect');
    expect(await emitWithAck(host.socket, 'lobby:deny', { participantId: guest.id })).toEqual({ ok: true });
    await denied;
    await disconnected;

    const retry = await connectSocket(server.url, guest.token);
    sockets.push(retry);
    expect((await emitWithAck(retry, 'room:join', {})).error.code).toBe('ADMISSION_DENIED');
  });

  it('removes people from the lobby list when they give up waiting', async () => {
    const { code, host } = await meetingWithHost({ waitingRoom: true });
    const guestArrived = nextEvent(host.socket, 'lobby:updated');
    const guest = await enter(code, 'Impatient');
    await guestArrived;

    const update = nextEvent(host.socket, 'lobby:updated');
    guest.socket.close();
    expect(await update).toEqual({ waiting: [] });
  });

  it('turning the waiting room off admits everyone who was waiting', async () => {
    const { code, host } = await meetingWithHost({ waitingRoom: true });
    const a = await enter(code, 'A');
    const b = await enter(code, 'B');

    const admittedA = nextEvent(a.socket, 'lobby:admitted');
    const admittedB = nextEvent(b.socket, 'lobby:admitted');
    const res = await emitWithAck(host.socket, 'meeting:update', { waitingRoom: false });
    expect(res).toEqual({ ok: true, settings: { allowGuests: true, waitingRoom: false, locked: false } });
    await Promise.all([admittedA, admittedB]);
    expect((await emitWithAck(a.socket, 'room:join', {})).ok).toBe(true);
  });
});

describe('remove participant', () => {
  it('disconnects them, tells everyone, and their token can’t come back', async () => {
    const { code, host } = await meetingWithHost();
    const target = await enter(code, 'Troll', { agent: member });
    const bystander = await enter(code, 'Bystander');

    const removedEvent = nextEvent(target.socket, 'participant:removed');
    const leftEvent = nextEvent(bystander.socket, 'peer:left');
    expect(await emitWithAck(host.socket, 'participant:remove', { participantId: target.id })).toEqual({ ok: true });

    await removedEvent;
    expect(await leftEvent).toEqual({ participantId: target.id });
    expect(server.rooms.get(code, target.id)).toBeUndefined();

    const retry = await connectSocket(server.url, target.token);
    sockets.push(retry);
    expect((await emitWithAck(retry, 'room:join', {})).error.code).toBe('REMOVED_FROM_MEETING');
  });

  it('bans a removed signed-in user from getting a new token for this meeting', async () => {
    const { code, host } = await meetingWithHost();
    const target = await enter(code, 'Member', { agent: member });
    await emitWithAck(host.socket, 'participant:remove', { participantId: target.id });

    const rejoin = await member.post(`/api/meetings/${code}/join`).send({ displayName: 'Member again' });
    expect(rejoin.status).toBe(403);
    expect(rejoin.body.error.code).toBe('REMOVED_FROM_MEETING');
  });

  it('won’t remove the host or yourself', async () => {
    const { code, host } = await meetingWithHost();
    const secondHostDevice = await enter(code, 'Owner (phone)', { agent: owner });

    expect((await emitWithAck(host.socket, 'participant:remove', { participantId: host.id })).error.code).toBe(
      'BAD_REQUEST',
    );
    expect(
      (await emitWithAck(host.socket, 'participant:remove', { participantId: secondHostDevice.id })).error.code,
    ).toBe('FORBIDDEN');
  });

  it('can’t reach participants of another meeting', async () => {
    const { host } = await meetingWithHost();
    const { code: otherCode } = await createMeetingAs(member);
    const stranger = await enter(otherCode, 'Stranger');

    const res = await emitWithAck(host.socket, 'participant:remove', { participantId: stranger.id });
    expect(res.error.code).toBe('NOT_FOUND');
    expect((await Participant.findById(stranger.id)).status).toBe('admitted');
  });
});

describe('lock meeting', () => {
  it('broadcasts the new settings and blocks new joins over REST', async () => {
    const { code, host } = await meetingWithHost();
    const guest = await enter(code, 'Inside');

    const settings = nextEvent(guest.socket, 'meeting:settings');
    await emitWithAck(host.socket, 'meeting:update', { locked: true });
    expect(await settings).toEqual({ allowGuests: true, waitingRoom: false, locked: true });

    const late = await request(server.app).post(`/api/meetings/${code}/join`).send({ displayName: 'Late' });
    expect(late.status).toBe(423);
    expect(late.body.error.code).toBe('MEETING_LOCKED');
  });

  it('blocks a token issued before the lock that never entered, but lets people inside reconnect', async () => {
    const { code, host } = await meetingWithHost();
    const inside = await enter(code, 'Inside');
    const tokenOnly = await enter(code, 'Token only', { join: false });

    await emitWithAck(host.socket, 'meeting:update', { locked: true });

    expect((await emitWithAck(tokenOnly.socket, 'room:join', {})).error.code).toBe('MEETING_LOCKED');

    inside.socket.close();
    const back = await connectSocket(server.url, inside.token);
    sockets.push(back);
    await expect.poll(async () => (await Participant.findById(inside.id)).enteredAt).toBeInstanceOf(Date);
    expect((await emitWithAck(back, 'room:join', {})).ok).toBe(true);
  });

  it('still lets the host admit someone from the waiting room', async () => {
    const { code, host } = await meetingWithHost({ waitingRoom: true });
    const waiting = await enter(code, 'Waiting');
    await emitWithAck(host.socket, 'meeting:update', { locked: true });

    const admitted = nextEvent(waiting.socket, 'lobby:admitted');
    await emitWithAck(host.socket, 'lobby:admit', { participantId: waiting.id });
    await admitted;
    expect((await emitWithAck(waiting.socket, 'room:join', {})).ok).toBe(true);
  });

  it('validates settings updates', async () => {
    const { host } = await meetingWithHost();
    expect((await emitWithAck(host.socket, 'meeting:update', {})).error.code).toBe('VALIDATION_ERROR');
    expect((await emitWithAck(host.socket, 'meeting:update', { locked: 'yes' })).error.code).toBe('VALIDATION_ERROR');
    expect((await emitWithAck(host.socket, 'meeting:update', { maxParticipants: 50 })).error.code).toBe(
      'VALIDATION_ERROR',
    );
  });
});

describe('host-only events are enforced on the server', () => {
  it.each(['member', 'guest'])('a %s gets FORBIDDEN for every host action, and nothing changes', async (role) => {
    const { code, host } = await meetingWithHost({ waitingRoom: true });
    // Admit the would-be attacker so they're genuinely in the room.
    const attacker = await enter(code, 'Attacker', { agent: role === 'member' ? member : undefined });
    await emitWithAck(host.socket, 'lobby:admit', { participantId: attacker.id });
    expect((await emitWithAck(attacker.socket, 'room:join', {})).ok).toBe(true);
    const victim = await enter(code, 'Victim'); // waiting

    const attempts = {
      'lobby:admit': { participantId: victim.id },
      'lobby:deny': { participantId: victim.id },
      'participant:remove': { participantId: host.id },
      'meeting:update': { locked: true, waitingRoom: false },
    };
    for (const [event, payload] of Object.entries(attempts)) {
      const res = await emitWithAck(attacker.socket, event, payload);
      expect(res, event).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: expect.any(String) } });
    }

    expect((await Participant.findById(victim.id)).status).toBe('waiting');
    expect(server.rooms.get(code, host.id)).toBeDefined();
    expect((await Meeting.findOne({ code })).settings).toMatchObject({ locked: false, waitingRoom: true });
  });

  it('host actions require being in the room, not just holding a host token', async () => {
    const { code } = await createMeetingAs(owner, { settings: { waitingRoom: true } });
    const hostNotJoined = await enter(code, 'Owner', { agent: owner, join: false });
    const res = await emitWithAck(hostNotJoined.socket, 'meeting:update', { locked: true });
    expect(res.error.code).toBe('NOT_IN_MEETING');
  });
});

describe('ending the meeting', () => {
  it('also tells people in the waiting room', async () => {
    const { code, host } = await meetingWithHost({ waitingRoom: true });
    const waiting = await enter(code, 'Waiting');

    const ended = nextEvent(waiting.socket, 'meeting:ended');
    await request(server.app).post(`/api/meetings/${code}/end`).set('Authorization', `Bearer ${host.token}`);
    expect(await ended).toEqual({ reason: 'host_ended' });
  });
});

describe('chat history respects admission', () => {
  const history = (code, token) =>
    request(server.app).get(`/api/meetings/${code}/messages`).set('Authorization', `Bearer ${token}`);

  it('is hidden from people in the waiting room, and from denied or removed people', async () => {
    const { code, host } = await meetingWithHost({ waitingRoom: true });
    await emitWithAck(host.socket, 'chat:send', { text: 'confidential', clientMsgId: 'client-msg-9' });

    // Waiting: holds a valid token for this meeting, but isn't admitted.
    const waiting = await enter(code, 'Waiting');
    const res = await history(code, waiting.token);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ADMITTED');

    // Admitted: can read.
    await emitWithAck(host.socket, 'lobby:admit', { participantId: waiting.id });
    expect((await history(code, waiting.token)).body.messages.map((m) => m.text)).toEqual(['confidential']);

    // Removed: can't read any more.
    await emitWithAck(waiting.socket, 'room:join', {});
    await emitWithAck(host.socket, 'participant:remove', { participantId: waiting.id });
    expect((await history(code, waiting.token)).status).toBe(403);
  });
});

describe('host actions on an ended meeting', () => {
  it('answer MEETING_ENDED instead of a generic error', async () => {
    const { code, host } = await meetingWithHost();
    await Meeting.updateOne({ code }, { status: 'ended' }); // ended elsewhere a moment ago
    const res = await emitWithAck(host.socket, 'meeting:update', { locked: true });
    expect(res.error.code).toBe('MEETING_ENDED');
  });
});
