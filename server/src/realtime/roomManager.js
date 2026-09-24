/**
 * In-memory registry of who is connected to which meeting right now, and who
 * is presenting.
 *
 * This is ephemeral state: it changes every few seconds and is rebuilt as
 * clients reconnect, so it lives in memory rather than MongoDB. With more than
 * one server instance it would move to Redis.
 *
 * peer = { participantId, displayName, role, socketId, joinedAt, media: { audio, video } }
 */
export class RoomManager {
  #rooms = new Map(); // code -> Map<participantId, peer>
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
   * Removes a peer only if it is still bound to `socketId`. When a participant
   * reconnects, the new socket replaces the old entry; the old socket's late
   * disconnect must not remove the new one.
   */
  remove(code, participantId, socketId) {
    const room = this.#rooms.get(code);
    const peer = room?.get(participantId);
    if (!peer || peer.socketId !== socketId) return null;

    room.delete(participantId);
    if (room.size === 0) this.deleteRoom(code);
    return peer;
  }

  deleteRoom(code) {
    this.#rooms.delete(code);
    this.#presenters.delete(code);
  }

  getPresenter(code) {
    return this.#presenters.get(code) ?? null;
  }

  setPresenter(code, participantId) {
    if (participantId) this.#presenters.set(code, participantId);
    else this.#presenters.delete(code);
  }
}

export function toPublicPeer({ participantId, displayName, role, joinedAt, media }) {
  return { participantId, displayName, role, joinedAt, media };
}
