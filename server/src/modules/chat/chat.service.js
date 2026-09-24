import { Message } from './message.model.js';

const DUPLICATE_KEY = 11000;

/**
 * Stores a chat message. If the same participant already sent this
 * clientMsgId (a retry after a lost ack), returns the stored message instead
 * of creating a duplicate. `created` tells the caller whether to broadcast.
 */
export async function postMessage({ meetingId, participantId, senderName, text, clientMsgId }) {
  try {
    const message = await Message.create({ meetingId, participantId, senderName, text, clientMsgId });
    return { message, created: true };
  } catch (err) {
    if (err.code !== DUPLICATE_KEY) throw err;
    const existing = await Message.findOne({ participantId, clientMsgId });
    if (!existing) throw err;
    return { message: existing, created: false };
  }
}

/** The `limit` most recent messages (optionally older than `before`), oldest first. */
export async function listMessages(meetingId, { before, limit }) {
  const query = { meetingId };
  if (before) query.createdAt = { $lt: before };
  const newestFirst = await Message.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit);
  return newestFirst.reverse();
}

export function deleteMessagesForMeeting(meetingId) {
  return Message.deleteMany({ meetingId });
}
