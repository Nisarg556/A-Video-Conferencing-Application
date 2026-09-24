import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { meetingEvents } from '../lib/events.js';
import { verifyParticipantToken } from '../lib/tokens.js';
import { Meeting } from '../modules/meetings/meeting.model.js';
import { Participant } from '../modules/meetings/participant.model.js';
import { touchMeeting } from '../modules/meetings/meeting.service.js';
import { toPublicPeer } from './roomManager.js';

/**
 * Presence over Socket.IO. Events (client <-> server):
 *   C->S room:join  (ack)  -> { ok, self, peers } | { ok: false, error }
 *   C->S room:leave (ack)
 *   S->C peer:joined  { participantId, displayName, role, joinedAt }
 *   S->C peer:left    { participantId }
 *   S->C meeting:ended { reason }
 *   S->C session:replaced   (same participant connected from another tab)
 * Errors use the same { code, message } shape as the REST API.
 */
export function attachSocketServer(httpServer, { rooms }) {
  const io = new Server(httpServer, {
    cors: { origin: env.CLIENT_URL },
    serveClient: false,
  });

  // Handshake auth: no valid participant token, no connection.
  io.use((socket, next) => {
    try {
      socket.data.participant = verifyParticipantToken(socket.handshake.auth?.token);
      next();
    } catch (err) {
      const error = new Error(err.message);
      error.data = { code: err.code ?? 'UNAUTHORIZED', message: err.message };
      next(error);
    }
  });

  io.on('connection', (socket) => {
    const me = socket.data.participant;
    let joined = false;

    socket.on('room:join', async (...args) => {
      const reply = ackFrom(args);
      try {
        if (joined) return reply({ ok: true, ...snapshot() });

        // Re-check the database: the meeting may have ended after the token was issued.
        const meeting = await Meeting.findById(me.meetingId);
        if (!meeting || meeting.status !== 'active') {
          return reply(fail('MEETING_ENDED', 'This meeting has ended'));
        }

        // Everything from here to rooms.add() is synchronous, so two sockets
        // can't both pass the capacity check (Node runs one callback at a time).
        const existing = rooms.get(me.code, me.participantId);
        if (!existing && rooms.count(me.code) >= meeting.maxParticipants) {
          return reply(fail('ROOM_FULL', `This meeting is full (max ${meeting.maxParticipants} people)`));
        }

        const peer = {
          participantId: me.participantId,
          displayName: me.displayName,
          role: me.role,
          socketId: socket.id,
          joinedAt: new Date().toISOString(),
        };
        rooms.add(me.code, peer);
        socket.join(me.code);
        joined = true;

        if (existing) {
          // Same participant, new socket (reload, second tab, network blip).
          // The new entry is registered first, so the old socket's disconnect
          // handler finds a different socketId and doesn't announce a leave.
          const old = io.sockets.sockets.get(existing.socketId);
          old?.emit('session:replaced');
          old?.disconnect(true);
        }

        reply({ ok: true, ...snapshot() });
        socket.to(me.code).emit('peer:joined', toPublicPeer(peer));

        persist(Participant.updateOne({ _id: me.participantId }, { leftAt: null }));
        persist(touchMeeting(me.meetingId));
      } catch (err) {
        console.error('room:join failed', err);
        reply(fail('INTERNAL_ERROR', 'Could not join the meeting'));
      }
    });

    socket.on('room:leave', (...args) => {
      leave();
      ackFrom(args)({ ok: true });
      socket.disconnect(true);
    });

    socket.on('disconnect', leave);

    function snapshot() {
      const peers = rooms.list(me.code).filter((p) => p.participantId !== me.participantId);
      return {
        self: toPublicPeer(rooms.get(me.code, me.participantId)),
        peers: peers.map(toPublicPeer),
      };
    }

    function leave() {
      if (!joined) return;
      joined = false;
      socket.leave(me.code);
      // No-op if a newer socket for this participant already replaced us.
      if (!rooms.remove(me.code, me.participantId, socket.id)) return;

      socket.to(me.code).emit('peer:left', { participantId: me.participantId });
      persist(Participant.updateOne({ _id: me.participantId }, { leftAt: new Date() }));
      persist(touchMeeting(me.meetingId));
    }
  });

  // A meeting ended via REST (host) or expiry: tell everyone, then disconnect them.
  const onMeetingEnded = ({ code, reason }) => {
    io.to(code).emit('meeting:ended', { reason });
    io.in(code).disconnectSockets(true);
    rooms.deleteRoom(code);
  };
  meetingEvents.on('ended', onMeetingEnded);

  return {
    io,
    close: () =>
      new Promise((resolve) => {
        meetingEvents.off('ended', onMeetingEnded);
        io.close(() => resolve());
      }),
  };
}

function ackFrom(args) {
  const last = args[args.length - 1];
  return typeof last === 'function' ? last : () => {};
}

function fail(code, message) {
  return { ok: false, error: { code, message } };
}

// Presence must not block on the database; log persistence failures instead.
function persist(promise) {
  promise.catch((err) => console.error('presence persistence failed', err));
}

