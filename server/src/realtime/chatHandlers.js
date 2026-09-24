import { postMessage } from '../modules/chat/chat.service.js';
import { chatSendSchema } from './schemas.js';
import { ackFrom, createRateLimiter, fail } from './socketUtils.js';

const CHAT_LIMIT = { max: 5, windowMs: 5000 };

/**
 * C->S chat:send (ack) { text, clientMsgId } -> { ok: true, message } | { ok: false, error }
 * S->C chat:message  { id, participantId, senderName, text, clientMsgId, createdAt }
 *
 * Messages only ever go to the sender's own meeting room; the sender's
 * identity comes from the verified token, not the payload.
 */
export function registerChatHandlers({ socket, me, isJoined }) {
  const allowMessage = createRateLimiter(CHAT_LIMIT);

  socket.on('chat:send', async (...args) => {
    const reply = ackFrom(args);
    if (!isJoined()) return reply(fail('NOT_IN_MEETING', 'Join the meeting before sending messages'));
    if (!allowMessage()) {
      return reply(fail('RATE_LIMITED', 'You’re sending messages too quickly. Wait a moment and try again.'));
    }

    const parsed = chatSendSchema.safeParse(args[0]);
    if (!parsed.success) return reply(fail('VALIDATION_ERROR', parsed.error.issues[0].message));

    try {
      const { message, created } = await postMessage({
        meetingId: me.meetingId,
        participantId: me.participantId,
        senderName: me.displayName,
        ...parsed.data,
      });
      const payload = message.toPublic();
      // A retried message was already broadcast the first time.
      if (created) socket.to(me.code).emit('chat:message', payload);
      reply({ ok: true, message: payload });
    } catch (err) {
      console.error('chat:send failed', err);
      reply(fail('INTERNAL_ERROR', 'Message could not be sent'));
    }
  });
}
