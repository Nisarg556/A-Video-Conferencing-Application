/**
 * In-memory registry of who is in each meeting right now, who is waiting to be
 * admitted, and who is presenting.
 *
 * This is ephemeral state: it changes every few seconds and is rebuilt as
 * clients reconnect, so it lives in memory rather than MongoDB. With more than
 * one server instance it would move to Redis.
 *
 * peer    = { participantId, displayName, role, socketId, joinedAt, media: { audio, video } }
 * waiting = { participantId, displayName, role, socketId, requestedAt }
 */
export class RoomManager {
  #rooms = new Map(); // code -> Map<participantId, peer>
  #lobbies = new Map(); // code -> Map<participantId, waiting>
  #presenters = new Map(); // code -> participantId currently sharing their screen

  count(code) {
    return this.#rooms.get(code)?.size ?? 0;
  }

  get(code, participantId) {
    return this.#rooms.get(code)?.get(participantId);
  }

  list(code) {
    return [...(this.#rooms.get(code)?.values() ?? [])];
  }

  add(code, peer) {
    if (!this.#rooms.has(code)) this.#rooms.set(code, new Map());
    this.#rooms.get(code).set(peer.participantId, peer);
  }

  /**
   * One seat is kept free for the host while they're not in the room, so the
   * owner can always get into their own meeting.
   */
  hasSeatFor(code, role, maxParticipants) {
    const count = this.count(code);
    if (role === 'host') return count < maxParticipants;
    const hostPresent = this.list(code).some((p) => p.role === 'host');
    return count < (hostPresent ? maxParticipants : maxParticipants - 1);
  }

  /**
   * Removes a peer only if it is still bound to `socketId`. When a participant
   * reconnects, the new socket replaces the old entry; the old socket's late
   * disconnect must not remove the new one.
   */
  remove(code, participantId, socketId) {
    const room = this.#rooms.get(code);
    const peer = room?.get(participantId);
    if (!peer || peer.socketId !== socketId) return null;

    room.delete(participantId);
    if (room.size === 0) {
      this.#rooms.delete(code);
      this.#presenters.delete(code);
    }
    return peer;
  }

  // ---- waiting room ----

  addWaiting(code, entry) {
    if (!this.#lobbies.has(code)) this.#lobbies.set(code, new Map());
    this.#lobbies.get(code).set(entry.participantId, entry);
  }

  getWaiting(code, participantId) {
    return this.#lobbies.get(code)?.get(participantId);
  }

  listWaiting(code) {
    return [...(this.#lobbies.get(code)?.values() ?? [])];
  }

  /** Like remove(): with a socketId, only removes the entry bound to that socket. */
  removeWaiting(code, participantId, socketId) {
    const lobby = this.#lobbies.get(code);
    const entry = lobby?.get(participantId);
    if (!entry || (socketId && entry.socketId !== socketId)) return null;
    lobby.delete(participantId);
    if (lobby.size === 0) this.#lobbies.delete(code);
    return entry;
  }

  // ---- presenter ----

  getPresenter(code) {
    return this.#presenters.get(code) ?? null;
  }

  setPresenter(code, participantId) {
    if (participantId) this.#presenters.set(code, participantId);
    else this.#presenters.delete(code);
  }

  deleteRoom(code) {
    this.#rooms.delete(code);
    this.#lobbies.delete(code);
    this.#presenters.delete(code);
  }
}

export function toPublicPeer({ participantId, displayName, role, joinedAt, media }) {
  return { participantId, displayName, role, joinedAt, media };
}

export function toPublicWaiting({ participantId, displayName, role, requestedAt }) {
  return { participantId, displayName, role, requestedAt };
}
