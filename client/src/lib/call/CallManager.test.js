import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallManager } from './CallManager.js';
import { FakeMediaStream, FakePeerConnection, FakeTrack, flush } from './testing/fakes.js';

const RTC_CONFIG = { iceServers: [{ urls: ['stun:stun.example.com'] }], iceTransportPolicy: 'all' };

beforeEach(() => {
  FakePeerConnection.instances = [];
  vi.stubGlobal('MediaStream', FakeMediaStream);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function createManager() {
  const sent = [];
  const manager = new CallManager({
    rtcConfig: RTC_CONFIG,
    sendSignal: (message) => sent.push(message),
    onChange: vi.fn(),
    createPeerConnection: (config) => new FakePeerConnection(config),
  });
  return { manager, sent };
}

/** Simulates the server relay: signals from one manager arrive at the other with `from` set. */
function deliver(messages, from, to) {
  for (const { to: _to, ...message } of messages.splice(0)) to.handleSignal({ ...message, from });
}

describe('CallManager', () => {
  it('as the newcomer, offers to everyone already in the room with our tracks attached', async () => {
    const { manager, sent } = createManager();
    const mic = new FakeTrack('audio');
    const cam = new FakeTrack('video');
    manager.setLocalTrack('audio', mic);
    manager.setLocalTrack('video', cam);

    manager.connectToAll(['alice', 'bob']);
    await flush();

    expect(sent.map((m) => [m.to, m.type])).toEqual([
      ['alice', 'offer'],
      ['bob', 'offer'],
    ]);
    expect(sent[0].connectionId).not.toBe(sent[1].connectionId);

    const pc = FakePeerConnection.instances[0];
    expect(pc.config).toBe(RTC_CONFIG);
    expect(pc.transceivers.map((t) => [t.sender.track, t.direction])).toEqual([
      [mic, 'sendrecv'],
      [cam, 'sendrecv'],
    ]);
  });

  it('completes an offer/answer/ICE exchange between two participants', async () => {
    const newcomer = createManager();
    const existing = createManager();
    const existingMic = new FakeTrack('audio');
    existing.manager.setLocalTrack('audio', existingMic);

    newcomer.manager.connectToAll(['existing']);
    await flush();
    deliver(newcomer.sent, 'newcomer', existing.manager); // offer
    await flush();

    // The existing participant answered and is now sending its mic.
    expect(existing.sent).toEqual([
      expect.objectContaining({ to: 'newcomer', type: 'answer', sdp: 'answer-sdp' }),
    ]);
    const answererPc = FakePeerConnection.instances[1];
    expect(answererPc.transceivers[0].sender.track).toBe(existingMic);
    expect(answererPc.transceivers.every((t) => t.direction === 'sendrecv')).toBe(true);

    deliver(existing.sent, 'existing', newcomer.manager); // answer
    await flush();
    const offererPc = FakePeerConnection.instances[0];
    expect(offererPc.remoteDescription).toEqual({ type: 'answer', sdp: 'answer-sdp' });

    // Trickle ICE both ways.
    offererPc.emitCandidate({ candidate: 'candidate:offerer' });
    answererPc.emitCandidate({ candidate: 'candidate:answerer' });
    deliver(newcomer.sent, 'newcomer', existing.manager);
    deliver(existing.sent, 'existing', newcomer.manager);
    await flush();

    expect(answererPc.addedCandidates).toEqual([{ candidate: 'candidate:offerer' }]);
    expect(offererPc.addedCandidates).toEqual([{ candidate: 'candidate:answerer' }]);
    expect(newcomer.manager.getPeer('existing').stream.getTracks()).toHaveLength(2);
  });

  it('buffers ICE candidates that arrive before the answer', async () => {
    const { manager, sent } = createManager();
    manager.connectToAll(['alice']);
    await flush();
    const { connectionId } = sent[0];

    manager.handleSignal({ from: 'alice', connectionId, type: 'candidate', candidate: { candidate: 'early' } });
    await flush();
    const pc = FakePeerConnection.instances[0];
    expect(pc.addedCandidates).toEqual([]);

    manager.handleSignal({ from: 'alice', connectionId, type: 'answer', sdp: 'answer-sdp' });
    await flush();
    expect(pc.addedCandidates).toEqual([{ candidate: 'early' }]);
  });

  it('replaces the connection when a peer offers again with a new connectionId (they reconnected)', async () => {
    const { manager, sent } = createManager();

    manager.handleSignal({ from: 'alice', connectionId: 'first-conn', type: 'offer', sdp: 'o1' });
    await flush();
    manager.handleSignal({ from: 'alice', connectionId: 'second-conn', type: 'offer', sdp: 'o2' });
    await flush();

    const [first, second] = FakePeerConnection.instances;
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    expect(sent.map((m) => m.connectionId)).toEqual(['first-conn', 'second-conn']);
  });

  it('ignores stale signals for a connection that was replaced', async () => {
    const { manager } = createManager();
    manager.handleSignal({ from: 'alice', connectionId: 'old-conn-1', type: 'offer', sdp: 'o1' });
    manager.handleSignal({ from: 'alice', connectionId: 'new-conn-2', type: 'offer', sdp: 'o2' });
    await flush();

    manager.handleSignal({ from: 'alice', connectionId: 'old-conn-1', type: 'candidate', candidate: { candidate: 'x' } });
    await flush();
    expect(FakePeerConnection.instances[1].addedCandidates).toEqual([]);
  });

  it('switches outgoing tracks on every connection without renegotiating', async () => {
    const { manager, sent } = createManager();
    manager.connectToAll(['alice', 'bob']);
    await flush();
    const offersBefore = sent.length;

    manager.setLocalTrack('video', null); // camera off
    const newCam = new FakeTrack('video');
    manager.setLocalTrack('video', newCam); // camera back on

    for (const pc of FakePeerConnection.instances) {
      expect(pc.transceivers[1].sender.replaced).toEqual([null, newCam]);
    }
    expect(sent).toHaveLength(offersBefore);
  });

  it('closes the connection when a participant leaves', async () => {
    const { manager } = createManager();
    manager.connectToAll(['alice']);
    await flush();

    manager.removePeer('alice');

    expect(FakePeerConnection.instances[0].closed).toBe(true);
    expect(manager.getPeer('alice')).toBeNull();
  });

  it('drops old connections and calls everyone again after our own rejoin', async () => {
    const { manager, sent } = createManager();
    manager.connectToAll(['alice']);
    await flush();

    manager.connectToAll(['alice', 'bob']); // e.g. our socket reconnected
    await flush();

    expect(FakePeerConnection.instances[0].closed).toBe(true);
    expect(sent.filter((m) => m.type === 'offer').map((m) => m.to)).toEqual(['alice', 'alice', 'bob']);
  });

  it('restarts ICE (as the offerer only) when the connection fails', async () => {
    const caller = createManager();
    caller.manager.connectToAll(['alice']);
    await flush();
    caller.manager.handleSignal({ from: 'alice', connectionId: caller.sent[0].connectionId, type: 'answer', sdp: 'a' });
    await flush();

    const pc = FakePeerConnection.instances[0];
    pc.setConnectionState('failed');
    await flush();
    expect(caller.sent.at(-1)).toMatchObject({ type: 'offer', sdp: 'offer-sdp-restart' });

    const callee = createManager();
    callee.manager.handleSignal({ from: 'bob', connectionId: 'conn-12345', type: 'offer', sdp: 'o' });
    await flush();
    FakePeerConnection.instances[1].setConnectionState('failed');
    await flush();
    expect(callee.sent.filter((m) => m.type === 'offer')).toHaveLength(0);
  });

  it('waits out a brief "disconnected" before restarting ICE', async () => {
    vi.useFakeTimers();
    const { manager, sent } = createManager();
    manager.connectToAll(['alice']);
    await vi.runOnlyPendingTimersAsync();
    const pc = FakePeerConnection.instances[0];

    pc.setConnectionState('disconnected');
    pc.setConnectionState('connected'); // recovered on its own
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent.filter((m) => m.type === 'offer')).toHaveLength(1);

    pc.setConnectionState('disconnected');
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent.filter((m) => m.type === 'offer')).toHaveLength(2);
  });
});
