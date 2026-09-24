const KINDS = ['audio', 'video'];
const MAX_ICE_RESTARTS = 3;
// "disconnected" often heals on its own (brief packet loss); only restart ICE
// if it lasts this long. "failed" restarts immediately.
const DISCONNECTED_GRACE_MS = 4000;

/**
 * One RTCPeerConnection to one remote participant.
 *
 * - role "offerer": we joined after them, so we create the offer.
 *   role "answerer": they joined after us; we only ever answer.
 *   Only the offerer sends offers, so the two sides can never offer at once (glare).
 * - Always exactly one audio + one video transceiver. Toggling the camera or
 *   mic swaps the track with replaceTrack(): no renegotiation needed.
 * - Signals are applied strictly in order through a promise queue, because
 *   each step (setRemoteDescription, createAnswer, …) is async.
 */
export class PeerLink {
  #pc;
  #queue = Promise.resolve();
  #senders = {};
  #pendingCandidates = [];
  #iceRestarts = 0;
  #disconnectTimer = null;
  #closed = false;

  constructor({
    participantId,
    connectionId,
    role,
    rtcConfig,
    getLocalTrack,
    sendSignal,
    onChange,
    createPeerConnection,
  }) {
    this.participantId = participantId;
    this.connectionId = connectionId;
    this.role = role;
    this.remoteStream = new MediaStream();
    this.connectionState = 'new';

    this.getLocalTrack = getLocalTrack;
    this.sendSignal = (message) => sendSignal({ to: participantId, connectionId, ...message });
    this.onChange = onChange;

    const pc = createPeerConnection(rtcConfig);
    this.#pc = pc;

    // Trickle ICE: send each candidate as soon as it's found.
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && !this.#closed) this.sendSignal({ type: 'candidate', candidate: candidate.toJSON() });
    };

    // Collect remote tracks into one stream (one track per kind).
    pc.ontrack = ({ track }) => {
      for (const old of this.remoteStream.getTracks()) {
        if (old.kind === track.kind && old !== track) this.remoteStream.removeTrack(old);
      }
      if (!this.remoteStream.getTracks().includes(track)) this.remoteStream.addTrack(track);
      this.onChange();
    };

    pc.onconnectionstatechange = () => this.#handleConnectionState(pc.connectionState);
  }

  /** Offerer only: create our transceivers with whatever tracks we have and send the offer. */
  start() {
    this.#enqueue(async () => {
      for (const kind of KINDS) {
        const transceiver = this.#pc.addTransceiver(this.getLocalTrack(kind) ?? kind, { direction: 'sendrecv' });
        this.#senders[kind] = transceiver.sender;
      }
      await this.#sendOffer();
    });
  }

  handleSignal(message) {
    this.#enqueue(() => this.#applySignal(message));
  }

  /** Swap the outgoing track (camera on/off, new device). Null sends nothing. */
  replaceTrack(kind, track) {
    const sender = this.#senders[kind];
    if (!sender || this.#closed) return; // answerer before the offer: attached in #applySignal
    sender.replaceTrack(track).catch((err) => console.warn(`replaceTrack(${kind}) failed`, err));
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#disconnectTimer);
    this.#pc.onicecandidate = this.#pc.ontrack = this.#pc.onconnectionstatechange = null;
    this.#pc.close();
    this.connectionState = 'closed';
  }

  // ---------------------------------------------------------------------------

  #enqueue(task) {
    this.#queue = this.#queue
      .then(() => (this.#closed ? undefined : task()))
      .catch((err) => console.warn(`[webrtc ${this.participantId}]`, err));
  }

  async #sendOffer({ iceRestart = false } = {}) {
    const offer = await this.#pc.createOffer({ iceRestart });
    await this.#pc.setLocalDescription(offer);
    this.sendSignal({ type: 'offer', sdp: this.#pc.localDescription.sdp });
  }

  async #applySignal({ type, sdp, candidate }) {
    const pc = this.#pc;

    if (type === 'offer') {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      // The offer created our transceivers (receive-only). Turn them into
      // send+receive and attach our current tracks before answering.
      for (const transceiver of pc.getTransceivers()) {
        const kind = transceiver.receiver.track.kind;
        if (!this.#senders[kind]) {
          transceiver.direction = 'sendrecv';
          this.#senders[kind] = transceiver.sender;
          await transceiver.sender.replaceTrack(this.getLocalTrack(kind) ?? null);
        }
      }
      await pc.setLocalDescription(await pc.createAnswer());
      this.sendSignal({ type: 'answer', sdp: pc.localDescription.sdp });
      await this.#flushCandidates();
    } else if (type === 'answer') {
      if (pc.signalingState !== 'have-local-offer') return; // duplicate/late answer
      await pc.setRemoteDescription({ type: 'answer', sdp });
      await this.#flushCandidates();
    } else if (type === 'candidate') {
      // A candidate can't be added before the remote description exists.
      if (!pc.remoteDescription) this.#pendingCandidates.push(candidate);
      else await this.#addCandidate(candidate);
    }
  }

  async #flushCandidates() {
    const pending = this.#pendingCandidates.splice(0);
    for (const candidate of pending) await this.#addCandidate(candidate);
  }

  async #addCandidate(candidate) {
    try {
      await this.#pc.addIceCandidate(candidate);
    } catch (err) {
      // One bad candidate shouldn't break the connection; others will work.
      console.warn('addIceCandidate failed', err);
    }
  }

  #handleConnectionState(state) {
    this.connectionState = state;
    clearTimeout(this.#disconnectTimer);

    if (state === 'connected') {
      this.#iceRestarts = 0;
    } else if (state === 'failed') {
      this.#restartIce();
    } else if (state === 'disconnected') {
      this.#disconnectTimer = setTimeout(() => this.#restartIce(), DISCONNECTED_GRACE_MS);
    }
    this.onChange();
  }

  /**
   * Network changed (Wi-Fi → mobile, VPN, sleep): gather new candidates on the
   * same connection. Only the offerer restarts, preserving "one side offers".
   * If the other person is really gone, peer:left closes this link instead.
   */
  #restartIce() {
    if (this.role !== 'offerer' || this.#closed || this.#iceRestarts >= MAX_ICE_RESTARTS) return;
    this.#iceRestarts += 1;
    this.#enqueue(() => this.#sendOffer({ iceRestart: true }));
  }
}
