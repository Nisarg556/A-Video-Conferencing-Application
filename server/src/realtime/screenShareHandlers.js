import { can } from '../lib/permissions.js';
import { meetingRoom } from './channels.js';
import { ackFrom, fail } from './socketUtils.js';

/**
 * One presenter per meeting, decided by the server so two people can't both
 * think they are presenting.
 *
 * C->S screen:start (ack) -> { ok: true } | { ok: false, error: SCREEN_SHARE_BUSY | NOT_IN_MEETING }
 * C->S screen:stop
 * S->C presenter:changed { participantId | null }
 *
 * The media itself doesn't go through here: the client swaps its outgoing
 * video track for the screen track (replaceTrack) on its peer connections.
 * Leaving/disconnecting also clears the presenter (see socketServer leave()).
 */
export function registerScreenShareHandlers({ socket, me, rooms, isJoined }) {
  socket.on('screen:start', (...args) => {
    const reply = ackFrom(args);
    if (!isJoined()) return reply(fail('NOT_IN_MEETING', 'Join the meeting before sharing your screen'));
    if (!can(me.role, 'screen.share')) return reply(fail('FORBIDDEN', 'You can’t share your screen'));

    const current = rooms.getPresenter(me.code);
    if (current && current !== me.participantId) {
      const name = rooms.get(me.code, current)?.displayName ?? 'Someone';
      return reply(fail('SCREEN_SHARE_BUSY', `${name} is already presenting`));
    }

    // Idempotent: re-claiming after a reconnect is fine and doesn't re-announce.
    if (current !== me.participantId) {
      rooms.setPresenter(me.code, me.participantId);
      socket.to(meetingRoom(me.code)).emit('presenter:changed', { participantId: me.participantId });
    }
    reply({ ok: true });
  });

  socket.on('screen:stop', () => {
    if (!isJoined() || rooms.getPresenter(me.code) !== me.participantId) return;
    rooms.setPresenter(me.code, null);
    socket.to(meetingRoom(me.code)).emit('presenter:changed', { participantId: null });
  });
}
