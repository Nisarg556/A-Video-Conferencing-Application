import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { meetingEvents } from '../lib/events.js';
import { verifyParticipantToken } from '../lib/tokens.js';
import { Meeting } from '../modules/meetings/meeting.model.js';
import { Participant } from '../modules/meetings/participant.model.js';
import { touchMeeting } from '../modules/meetings/meeting.service.js';
import { hostsRoom, lobbyRoom, meetingRoom } from './channels.js';
import { registerChatHandlers } from './chatHandlers.js';
import { lobbySnapshot, registerHostHandlers } from './hostHandlers.js';
import { toPublicPeer, toPublicWaiting } from './roomManager.js';
import { joinPayloadSchema, mediaStateSchema, signalSchema } from './schemas.js';
import { registerScreenShareHandlers } from './screenShareHandlers.js';
import { logger } from '../lib/logger.js';
import { ackFrom, createRateLimiter, fail, failFromError, persist } from './socketUtils.js';

// A connection setup is 1 offer/answer + a few dozen ICE candidates per peer;
// this leaves plenty of room for 3 peers + ICE restarts while stopping floods.
const SIGNAL_LIMIT = { max: 300, windowMs: 10_000 };

/**
 * Presence, admission and WebRTC signaling over Socket.IO.
 *
 *   C->S room:join   (ack) { media }
 *        -> { ok, waiting: true }                       (waiting room)
 *        -> { ok, self, peers, presenterId, settings, lobby? }   (in the room; lobby for hosts)
 *        -> { ok: false, error: MEETING_ENDED | ROOM_FULL | MEETING_LOCKED
 *                               | ADMISSION_DENIED | REMOVED_FROM_MEETING }
 *   C->S room:leave  (ack)
 *   C->S media:state { audio, video }
 *   C->S signal      { to, connectionId, type: offer|answer|candidate, sdp?, candidate? }
 *   S->C peer:joined / peer:left / peer:media / signal / meeting:ended / session:replaced
 * Chat: chatHandlers.js · Screen share: screenShareHandlers.js · Host controls: hostHandlers.js
 *
 * Admission is re-read from MongoDB on every room:join, so a participant token
 * issued earlier can't get around a later deny, removal or lock.
 */
export function attachSocketServer(httpServer, { rooms }) {
  const io = new Server(httpServer, {
    cors: { origin: env.CLIENT_URL, credentials: true },
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

  const notifyHosts = (code) => io.to(hostsRoom(code)).emit('lobby:updated', { waiting: lobbySnapshot(rooms, code) });

  io.on('connection', (socket) => {
    const me = socket.data.participant;
    const allowSignal = createRateLimiter(SIGNAL_LIMIT);
    let joined = false; // admitted and in the meeting room
    let waiting = false; // in the waiting room
    const isJoined = () => joined;

    registerChatHandlers({ socket, me, isJoined });
    registerScreenShareHandlers({ socket, me, rooms, isJoined });
    registerHostHandlers({ io, socket, me, rooms, isJoined, notifyHosts: () => notifyHosts(me.code) });

    socket.on('room:join', async (...args) => {
      const reply = ackFrom(args);
      try {
        const payload = joinPayloadSchema.safeParse(args[0]);
        if (!payload.success) return reply(fail('VALIDATION_ERROR', 'Invalid room:join payload'));

        const [meeting, participant] = await Promise.all([
          Meeting.findById(me.meetingId),
          Participant.findById(me.participantId),
        ]);
        if (!meeting || meeting.status !== 'active') return reply(fail('MEETING_ENDED', 'This meeting has ended'));
        if (joined) return reply({ ok: true, ...snapshot(meeting) });

        // Authoritative admission state (the token only proves identity + role).
        if (!participant) return reply(fail('UNAUTHORIZED', 'Unknown participant'));
        if (participant.status === 'removed') {
          return reply(fail('REMOVED_FROM_MEETING', 'The host removed you from this meeting'));
        }
        if (participant.status === 'denied') return reply(fail('ADMISSION_DENIED', 'The host didn’t let you in'));

        if (participant.status === 'waiting') {
          rooms.addWaiting(me.code, {
            participantId: me.participantId,
            displayName: me.displayName,
            role: me.role,
            socketId: socket.id,
            requestedAt: participant.joinedAt.toISOString(),
          });
          waiting = true;
          socket.join(lobbyRoom(me.code));
          reply({ ok: true, waiting: true, settings: meeting.toPublic().settings });
          notifyHosts(me.code);
          logger.info({ code: me.code, participantId: me.participantId, role: me.role }, 'waiting for admission');
          return;
        }

        // Admitted. A lock stops people who never got in, unless the host
        // personally admitted them; people already inside may reconnect.
        const lockedOut =
          meeting.settings.locked && me.role !== 'host' && !participant.enteredAt && participant.admittedBy !== 'host';
        if (lockedOut) return reply(fail('MEETING_LOCKED', 'The host has locked this meeting'));

        // Everything from here to rooms.add() is synchronous, so two sockets
        // can't both take the last seat (Node runs one callback at a time).
        const existing = rooms.get(me.code, me.participantId);
        if (!existing && !rooms.hasSeatFor(me.code, me.role, meeting.maxParticipants)) {
          return reply(fail('ROOM_FULL', `This meeting is full (max ${meeting.maxParticipants} people)`));
        }

        leaveLobby();
        const peer = {
          participantId: me.participantId,
          displayName: me.displayName,
          role: me.role,
          socketId: socket.id,
          joinedAt: new Date().toISOString(),
          media: payload.data.media,
        };
        rooms.add(me.code, peer);
        socket.join(meetingRoom(me.code));
        if (me.role === 'host') socket.join(hostsRoom(me.code));
        joined = true;

        if (existing) {
          // Same participant, new socket (reload, second tab, network blip).
          // The new entry is registered first, so the old socket's disconnect
          // handler finds a different socketId and doesn't announce a leave.
          const old = io.sockets.sockets.get(existing.socketId);
          old?.emit('session:replaced');
          old?.disconnect(true);
        }

        reply({ ok: true, ...snapshot(meeting) });
        logger.info(
          { code: me.code, participantId: me.participantId, role: me.role, replaced: Boolean(existing) },
          'joined meeting',
        );
        // Others close any old connection to this participant and wait for
        // the newcomer's offer (the newcomer always initiates).
        socket.to(meetingRoom(me.code)).emit('peer:joined', toPublicPeer(peer));

        persist(
          Participant.updateOne(
            { _id: me.participantId },
            { leftAt: null, ...(!participant.enteredAt && { enteredAt: new Date() }) },
          ),
        );
        persist(touchMeeting(me.meetingId));
      } catch (err) {
        reply(failFromError(err, { event: 'room:join', code: me.code }));
      }
    });

    socket.on('media:state', (payload) => {
      if (!joined) return;
      const parsed = mediaStateSchema.safeParse(payload);
      const peer = rooms.get(me.code, me.participantId);
      if (!parsed.success || peer?.socketId !== socket.id) return;

      peer.media = parsed.data;
      socket.to(meetingRoom(me.code)).emit('peer:media', { participantId: me.participantId, ...parsed.data });
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
    socket.on('disconnect', () => {
      leaveLobby();
      leave();
    });

    function snapshot(meeting) {
      const peers = rooms.list(me.code).filter((p) => p.participantId !== me.participantId);
      return {
        self: toPublicPeer(rooms.get(me.code, me.participantId)),
        peers: peers.map(toPublicPeer),
        presenterId: rooms.getPresenter(me.code),
        settings: meeting.toPublic().settings,
        ...(me.role === 'host' && { lobby: rooms.listWaiting(me.code).map(toPublicWaiting) }),
      };
    }

    function leaveLobby() {
      if (!waiting) return;
      waiting = false;
      socket.leave(lobbyRoom(me.code));
      if (rooms.removeWaiting(me.code, me.participantId, socket.id)) notifyHosts(me.code);
    }

    function leave() {
      if (!joined) return;
      joined = false;
      socket.leave(meetingRoom(me.code));
      socket.leave(hostsRoom(me.code));
      const wasPresenting = rooms.getPresenter(me.code) === me.participantId;
      // No-op if a newer socket for this participant already replaced us.
      if (!rooms.remove(me.code, me.participantId, socket.id)) return;

      if (wasPresenting) {
        // Presenter closed the tab mid-share: free the slot for everyone.
        rooms.setPresenter(me.code, null);
        socket.to(meetingRoom(me.code)).emit('presenter:changed', { participantId: null });
      }
      socket.to(meetingRoom(me.code)).emit('peer:left', { participantId: me.participantId });
      logger.info({ code: me.code, participantId: me.participantId }, 'left meeting');
      persist(Participant.updateOne({ _id: me.participantId }, { leftAt: new Date() }));
      persist(touchMeeting(me.meetingId));
    }
  });

  // A meeting ended via REST (host) or expiry: tell everyone (including the
  // waiting room), then disconnect them.
  const onMeetingEnded = ({ code, reason }) => {
    logger.info({ code, reason }, 'meeting ended');
    io.to(meetingRoom(code)).to(lobbyRoom(code)).emit('meeting:ended', { reason });
    io.in(meetingRoom(code)).disconnectSockets(true);
    io.in(lobbyRoom(code)).disconnectSockets(true);
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
