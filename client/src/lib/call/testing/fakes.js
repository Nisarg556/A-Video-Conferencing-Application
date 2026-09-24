// Minimal stand-ins for browser WebRTC objects, enough to exercise the
// negotiation logic in Node. They record calls instead of doing networking.

export class FakeTrack {
  constructor(kind, id = `${kind}-${Math.random().toString(36).slice(2, 8)}`) {
    this.kind = kind;
    this.id = id;
  }
}

export class FakeMediaStream {
  #tracks = [];
  constructor(tracks = []) {
    this.#tracks = [...tracks];
  }
  getTracks() {
    return [...this.#tracks];
  }
  addTrack(track) {
    this.#tracks.push(track);
  }
  removeTrack(track) {
    this.#tracks = this.#tracks.filter((t) => t !== track);
  }
}

class FakeSender {
  constructor(track) {
    this.track = track ?? null;
    this.replaced = [];
  }
  async replaceTrack(track) {
    this.track = track;
    this.replaced.push(track);
  }
  getParameters() {
    // Browsers return no encodings until the connection is negotiated.
    return structuredClone(this.parameters ?? { encodings: [] });
  }
  async setParameters(params) {
    this.parameters = structuredClone(params);
  }
}

class FakeTransceiver {
  constructor(kind, track, direction) {
    this.receiver = { track: new FakeTrack(kind, `remote-${kind}`) };
    this.sender = new FakeSender(track);
    this.direction = direction;
  }
}

export class FakePeerConnection {
  static instances = [];

  constructor(config) {
    this.config = config;
    this.transceivers = [];
    this.localDescription = null;
    this.remoteDescription = null;
    this.signalingState = 'stable';
    this.connectionState = 'new';
    this.addedCandidates = [];
    this.offerOptions = [];
    this.closed = false;
    FakePeerConnection.instances.push(this);
  }

  addTransceiver(trackOrKind, { direction }) {
    const kind = typeof trackOrKind === 'string' ? trackOrKind : trackOrKind.kind;
    const track = typeof trackOrKind === 'string' ? null : trackOrKind;
    const transceiver = new FakeTransceiver(kind, track, direction);
    this.transceivers.push(transceiver);
    return transceiver;
  }

  getTransceivers() {
    return this.transceivers;
  }

  async createOffer(options = {}) {
    this.offerOptions.push(options);
    return { type: 'offer', sdp: `offer-sdp${options.iceRestart ? '-restart' : ''}` };
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'answer-sdp' };
  }

  async setLocalDescription(description) {
    this.localDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
  }

  async setRemoteDescription(description) {
    this.remoteDescription = description;
    if (description.type === 'offer') {
      // Like a browser: an offer creates receive-only transceivers on the answerer.
      if (this.transceivers.length === 0) {
        for (const kind of ['audio', 'video']) {
          const t = new FakeTransceiver(kind, null, 'recvonly');
          this.transceivers.push(t);
          this.ontrack?.({ track: t.receiver.track });
        }
      }
      this.signalingState = 'have-remote-offer';
    } else {
      this.signalingState = 'stable';
      for (const t of this.transceivers) this.ontrack?.({ track: t.receiver.track });
    }
  }

  async addIceCandidate(candidate) {
    if (!this.remoteDescription) throw new Error('InvalidStateError: no remote description');
    this.addedCandidates.push(candidate);
  }

  close() {
    this.closed = true;
    this.connectionState = 'closed';
  }

  // Test helpers
  emitCandidate(candidate) {
    this.onicecandidate?.({ candidate: { toJSON: () => candidate } });
  }

  setConnectionState(state) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

/** Waits for PeerLink's async signal queue to drain. */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
