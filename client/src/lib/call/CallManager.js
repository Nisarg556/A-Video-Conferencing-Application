import { PeerLink } from './PeerLink.js';

function newConnectionId() {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * Owns the mesh: one PeerLink per remote participant.
 *
 * Rules (see README "Signaling"):
 *  1. After every successful room:join we are the newcomer: close all old
 *     links and offer to everyone in the snapshot.
 *  2. When someone else joins (or re-joins), drop any old link to them and
 *     wait for their offer.
 *  3. An offer with a new connectionId replaces the link; signals for an old
 *     connectionId are stale and ignored.
 *  4. peer:left / leaving closes the link and releases its resources.
 */
export class CallManager {
  #links = new Map(); // participantId -> PeerLink
  #localTracks = { audio: null, video: null };

  constructor({
    rtcConfig,
    sendSignal,
    onChange,
    createPeerConnection = (config) => new RTCPeerConnection(config),
  }) {
    this.rtcConfig = rtcConfig;
    this.sendSignal = sendSignal;
    this.onChange = onChange;
    this.createPeerConnection = createPeerConnection;
  }

  /** Rule 1: we just (re)joined; call everyone already in the room. */
  connectToAll(participantIds) {
    this.closeAll();
    for (const participantId of participantIds) {
      this.#createLink(participantId, newConnectionId(), 'offerer').start();
    }
    this.onChange();
  }

  /** Rule 2: they joined after us (or reconnected) and will send an offer. */
  expectOfferFrom(participantId) {
    this.removePeer(participantId);
  }

  /** Rule 3: route an incoming signal to the right link. */
  handleSignal({ from, connectionId, ...message }) {
    let link = this.#links.get(from);

    if (message.type === 'offer' && link?.connectionId !== connectionId) {
      link?.close();
      link = this.#createLink(from, connectionId, 'answerer');
      this.onChange();
    }

    if (!link || link.connectionId !== connectionId) return; // stale
    link.handleSignal(message);
  }

  /** Rule 4 */
  removePeer(participantId) {
    const link = this.#links.get(participantId);
    if (!link) return;
    link.close();
    this.#links.delete(participantId);
    this.onChange();
  }

  closeAll() {
    for (const link of this.#links.values()) link.close();
    this.#links.clear();
  }

  /** Camera/mic changed: every connection sends the new track (or nothing). */
  setLocalTrack(kind, track) {
    this.#localTracks[kind] = track;
    for (const link of this.#links.values()) link.replaceTrack(kind, track);
  }

  /** participantId -> speaking level (0..1), for active-speaker detection. */
  getAudioLevels() {
    const levels = new Map();
    for (const [participantId, link] of this.#links) levels.set(participantId, link.getAudioLevel());
    return levels;
  }

  getPeer(participantId) {
    const link = this.#links.get(participantId);
    return link ? { stream: link.remoteStream, connectionState: link.connectionState } : null;
  }

  #createLink(participantId, connectionId, role) {
    const link = new PeerLink({
      participantId,
      connectionId,
      role,
      rtcConfig: this.rtcConfig,
      getLocalTrack: (kind) => this.#localTracks[kind],
      sendSignal: this.sendSignal,
      onChange: this.onChange,
      createPeerConnection: this.createPeerConnection,
    });
    this.#links.set(participantId, link);
    return link;
  }
}
