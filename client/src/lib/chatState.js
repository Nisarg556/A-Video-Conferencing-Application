export const CHAT_MAX_LENGTH = 1000;
const MAX_KEPT = 500;

export const initialChatState = { messages: [], unread: 0, historyError: null };

/**
 * Chat message shape in the UI:
 *   { key, id?, clientMsgId, participantId, senderName, text, createdAt,
 *     status: 'sent' | 'pending' | 'failed', error? }
 *
 * Messages are matched by server id, or by (participantId, clientMsgId) so an
 * optimistic "pending" message merges with its server copy instead of
 * appearing twice.
 */
export function chatReducer(state, action) {
  switch (action.type) {
    case 'pending':
      return withMessages(state, [...state.messages, { ...action.message, key: action.message.clientMsgId, status: 'pending' }]);

    case 'confirmed':
      return withMessages(state, upsert(removeByClientId(state.messages, action.clientMsgId), sent(action.message)));

    case 'failed':
      return withMessages(
        state,
        state.messages.map((m) =>
          m.clientMsgId === action.clientMsgId && m.status === 'pending' ? { ...m, status: 'failed', error: action.error } : m,
        ),
      );

    case 'retrying':
      return withMessages(
        state,
        state.messages.map((m) => (m.clientMsgId === action.clientMsgId ? { ...m, status: 'pending', error: undefined } : m)),
      );

    case 'received': {
      if (findIndex(state.messages, action.message) !== -1) return state;
      const next = withMessages(state, upsert(state.messages, sent(action.message)));
      return action.countAsUnread ? { ...next, unread: state.unread + 1 } : next;
    }

    case 'history': {
      // Initial load or re-sync after reconnect: merge, never drop local pending/failed.
      let messages = state.messages;
      for (const message of action.messages) messages = upsert(messages, sent(message));
      return { ...withMessages(state, messages), historyError: null };
    }

    case 'historyFailed':
      return { ...state, historyError: action.error };

    case 'markRead':
      return state.unread === 0 ? state : { ...state, unread: 0 };

    default:
      return state;
  }
}

function sent(message) {
  return { ...message, key: message.id, status: 'sent' };
}

function findIndex(messages, message) {
  return messages.findIndex(
    (m) =>
      (message.id && m.id === message.id) ||
      (m.clientMsgId === message.clientMsgId && m.participantId === message.participantId),
  );
}

function upsert(messages, message) {
  const index = findIndex(messages, message);
  if (index === -1) return [...messages, message];
  const copy = [...messages];
  copy[index] = message;
  return copy;
}

function removeByClientId(messages, clientMsgId) {
  return messages.filter((m) => !(m.clientMsgId === clientMsgId && m.status !== 'sent'));
}

function withMessages(state, messages) {
  // Server time order; unsent messages (local timestamps) stay at the end.
  const ordered = [...messages].sort((a, b) => {
    const aSent = a.status === 'sent';
    const bSent = b.status === 'sent';
    if (aSent !== bSent) return aSent ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
  return { ...state, messages: ordered.slice(-MAX_KEPT) };
}

/** Client-side check for instant feedback; the server re-validates. */
export function validateDraft(text) {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  if (trimmed.length > CHAT_MAX_LENGTH) return { ok: false, reason: 'too-long' };
  return { ok: true, text: trimmed };
}
