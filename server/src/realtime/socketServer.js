import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { meetingEvents } from '../lib/events.js';
import { verifyParticipantToken } from '../lib/tokens.js';
import { Meeting } from '../modules/meetings/meeting.model.js';
import { Participant } from '../modules/meetings/participant.model.js';
import { touchMeeting } from '../modules/meetings/meeting.service.js';
import { registerChatHandlers } from './chatHandlers.js';
import { toPublicPeer } from './roomManager.js';
import { joinPayloadSchema, mediaStateSchema, signalSchema } from './schemas.js';
import { registerScreenShareHandlers } from './screenShareHandlers.js';
import { ackFrom, createRateLimiter, fail, persist } from './socketUtils.js';

// A connection setup is 1 offer/answer + a few dozen ICE candidates per peer;
// this leaves plenty of room for 3 peers + ICE restarts while stopping floods.
const SIGNAL_LIMIT = { max: 300, windowMs: 10_000 };

/**
 * Presence + WebRTC signaling over Socket.IO. Events (client <-> server):
 *   C->S room:join   (ack) { media }  -> { ok, self, peers, presenterId } | { ok: false, error }
 *   C->S room:leave  (ack)
 *   C->S media:state { audio, video }
 *   C->S signal      { to, connectionId, type: offer|answer|candidate, sdp?, candidate? }
 *   S->C peer:joined { participantId, displayName, role, joinedAt, media }
 *   S->C peer:left   { participantId }
 *   S->C peer:media  { participantId, audio, video }
 *   S->C signal      { from, connectionId, type, sdp?, candidate? }
 *   S->C meeting:ended { reason }
 *   S->C session:replaced   (same participant connected from another tab)
 * Chat: see chatHandlers.js. Screen share: see screenShareHandlers.js.
 * Errors use the same { code, message } shape as the REST API.
 *
 * The server never looks inside SDP; it only decides who may talk to whom.
 */
export function attachSocketServer(httpServer, { rooms }) {
  const io = new Server(httpServer, {
    cors: { origin: env.CLIENT_URL },
    serveClient: false,
    // Largest legitimate message is an SDP (< 64 KB); reject anything bigger.
    maxHttpBufferSize: 100_000,
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
    const allowSignal = createRateLimiter(SIGNAL_LIMIT);
    let joined = false;
    const isJoined = () => joined;

    registerChatHandlers({ socket, me, isJoined });
    registerScreenShareHandlers({ socket, me, rooms, isJoined });

    socket.on('room:join', async (...args) => {
      const reply = ackFrom(args);
      try {
        if (joined) return reply({ ok: true, ...snapshot() });

        const payload = joinPayloadSchema.safeParse(args[0]);
        if (!payload.success) return reply(fail('VALIDATION_ERROR', 'Invalid room:join payload'));

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
          media: payload.data.media,
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
        // Others close any old connection to this participant and wait for
        // the newcomer's offer (the newcomer always initiates).
        socket.to(me.code).emit('peer:joined', toPublicPeer(peer));

        persist(Participant.updateOne({ _id: me.participantId }, { leftAt: null }));
        persist(touchMeeting(me.meetingId));
      } catch (err) {
        console.error('room:join failed', err);
        reply(fail('INTERNAL_ERROR', 'Could not join the meeting'));
      }
    });

    socket.on('media:state', (payload) => {
      if (!joined) return;
      const parsed = mediaStateSchema.safeParse(payload);
      const peer = rooms.get(me.code, me.participantId);
      if (!parsed.success || peer?.socketId !== socket.id) return;

      peer.media = parsed.data;
      socket.to(me.code).emit('peer:media', { participantId: me.participantId, ...parsed.data });
    });

    // Relay offers/answers/ICE candidates to exactly one other participant.
    socket.on('signal', (payload) => {
      if (!joined || !allowSignal()) return;
      const parsed = signalSchema.safeParse(payload);
      if (!parsed.success) return;

      const { to, ...message } = parsed.data;
      if (to === me.participantId) return;
      // Target must be in *this* meeting: a signal can never cross rooms.
      const target = rooms.get(me.code, to);
      if (!target) return;

      // "from" comes from the verified token, never from the client payload.
      io.to(target.socketId).emit('signal', { from: me.participantId, ...message });
    });

    socket.on('room:leave', (...args) => {
      leave();
      ackFrom(args)({ ok: true });
      socket.disconnect(true);
    });

    // Tab closed, network lost (after Socket.IO's ping timeout), or kicked.
    socket.on('disconnect', leave);

    function snapshot() {
      const peers = rooms.list(me.code).filter((p) => p.participantId !== me.participantId);
      return {
        self: toPublicPeer(rooms.get(me.code, me.participantId)),
        peers: peers.map(toPublicPeer),
        presenterId: rooms.getPresenter(me.code),
      };
    }

    function leave() {
      if (!joined) return;
      joined = false;
      socket.leave(me.code);
      const wasPresenting = rooms.getPresenter(me.code) === me.participantId;
      // No-op if a newer socket for this participant already replaced us.
      if (!rooms.remove(me.code, me.participantId, socket.id)) return;

      if (wasPresenting) {
        // Presenter closed the tab mid-share: free the slot for everyone.
        rooms.setPresenter(me.code, null);
        socket.to(me.code).emit('presenter:changed', { participantId: null });
      }
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
