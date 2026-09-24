import { z } from 'zod';
import { can } from '../lib/permissions.js';
import { Meeting } from '../modules/meetings/meeting.model.js';
import { updateSettingsSchema } from '../modules/meetings/meeting.schemas.js';
import { updateSettings } from '../modules/meetings/meeting.service.js';
import { Participant } from '../modules/meetings/participant.model.js';
import { lobbyRoom, meetingRoom } from './channels.js';
import { toPublicWaiting } from './roomManager.js';
import { ackFrom, fail } from './socketUtils.js';

const targetSchema = z.object({ participantId: z.string().regex(/^[a-f0-9]{24}$/) });

/**
 * Host controls (all with ack). Every handler checks, on the server:
 *   1. the caller is admitted and in the room, and
 *   2. their role has the permission (see lib/permissions.js).
 *
 * C->S lobby:admit        { participantId }           -> waiting person enters
 * C->S lobby:deny         { participantId }           -> waiting person refused
 * C->S participant:remove { participantId }           -> kicked (+ banned if signed in)
 * C->S meeting:update     { locked?, waitingRoom?, allowGuests? }
 * S->C lobby:updated      { waiting: [...] }          (hosts only)
 * S->C lobby:admitted / lobby:denied                  (to the waiting person)
 * S->C participant:removed                            (to the removed person)
 * S->C meeting:settings   { allowGuests, waitingRoom, locked } (everyone)
 */
export function registerHostHandlers({ io, socket, me, rooms, isJoined, notifyHosts }) {
  function handle(event, permission, schema, action) {
    socket.on(event, async (...args) => {
      const reply = ackFrom(args);
      if (!isJoined()) return reply(fail('NOT_IN_MEETING', 'Join the meeting first'));
      if (!can(me.role, permission)) return reply(fail('FORBIDDEN', 'Only the host can do that'));
      const parsed = schema.safeParse(args[0]);
      if (!parsed.success) return reply(fail('VALIDATION_ERROR', parsed.error.issues[0].message));
      try {
        reply(await action(parsed.data));
      } catch (err) {
        console.error(`${event} failed`, err);
        reply(fail('INTERNAL_ERROR', 'Something went wrong'));
      }
    });
  }

  handle('lobby:admit', 'lobby.admit', targetSchema, async ({ participantId }) => {
    const entry = rooms.getWaiting(me.code, participantId);
    if (!entry) return fail('NOT_FOUND', 'That person is no longer waiting');
    await admit([participantId]);
    return { ok: true };
  });

  handle('lobby:deny', 'lobby.deny', targetSchema, async ({ participantId }) => {
    const entry = rooms.removeWaiting(me.code, participantId);
    if (!entry) return fail('NOT_FOUND', 'That person is no longer waiting');
    // meetingId in the filter: a host can only affect their own meeting's participants.
    await Participant.updateOne({ _id: participantId, meetingId: me.meetingId }, { status: 'denied' });
    const target = io.sockets.sockets.get(entry.socketId);
    target?.emit('lobby:denied');
    target?.disconnect(true);
    notifyHosts();
    return { ok: true };
  });

  handle('participant:remove', 'participant.remove', targetSchema, async ({ participantId }) => {
    if (participantId === me.participantId) return fail('BAD_REQUEST', 'You can’t remove yourself');
    const target = rooms.get(me.code, participantId);
    if (!target) return fail('NOT_FOUND', 'That person isn’t in the meeting');
    if (target.role === 'host') return fail('FORBIDDEN', 'The host can’t be removed');

    const participant = await Participant.findOneAndUpdate(
      { _id: participantId, meetingId: me.meetingId },
      { status: 'removed' },
      { new: true },
    );
    // Signed-in users are banned from this meeting; guests can only be
    // stopped from coming back by locking or the waiting room.
    if (participant?.userId) {
      await Meeting.updateOne({ _id: me.meetingId }, { $addToSet: { bannedUserIds: participant.userId } });
    }

    const targetSocket = io.sockets.sockets.get(target.socketId);
    targetSocket?.emit('participant:removed');
    targetSocket?.disconnect(true); // runs their leave(): peer:left, presenter cleared
    return { ok: true };
  });

  handle('meeting:update', 'meeting.updateSettings', updateSettingsSchema, async (changes) => {
    const meeting = await updateSettings(me.meetingId, changes);
    const { settings } = meeting.toPublic();
    io.to(meetingRoom(me.code)).emit('meeting:settings', settings);
    io.to(lobbyRoom(me.code)).emit('meeting:settings', settings);
    // Turning the waiting room off lets everyone who was waiting in.
    if (changes.waitingRoom === false) {
      await admit(rooms.listWaiting(me.code).map((w) => w.participantId));
    }
    return { ok: true, settings };
  });

  async function admit(participantIds) {
    if (participantIds.length === 0) return;
    await Participant.updateMany(
      { _id: { $in: participantIds }, meetingId: me.meetingId, status: 'waiting' },
      { status: 'admitted', admittedBy: 'host', admittedAt: new Date() },
    );
    for (const id of participantIds) {
      const entry = rooms.removeWaiting(me.code, id);
      // The client answers by emitting room:join again, now as admitted.
      if (entry) io.to(entry.socketId).emit('lobby:admitted');
    }
    notifyHosts();
  }
}

export function lobbySnapshot(rooms, code) {
  return rooms.listWaiting(code).map(toPublicWaiting);
}


