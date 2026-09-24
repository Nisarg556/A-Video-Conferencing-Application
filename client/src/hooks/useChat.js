import { useCallback, useEffect, useReducer, useRef } from 'react';
import { getMessages } from '../api/meetings.js';
import { chatReducer, initialChatState } from '../lib/chatState.js';

const newClientMsgId = () => crypto.randomUUID().replace(/-/g, '');

/**
 * In-meeting chat over the meeting's socket.
 *  - Sends optimistically (message shows as "sending…"), then confirms via ack.
 *  - A failed send can be retried with the same clientMsgId, so if the first
 *    attempt actually reached the server there's still only one message.
 *  - History is (re)loaded after every join, which also fills any gap from a
 *    reconnect.
 */
export function useChat({ socket, joinCount, code, token, self, visible }) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (!socket) return;
    const onMessage = (message) => dispatch({ type: 'received', message, countAsUnread: !visibleRef.current });
    socket.on('chat:message', onMessage);
    return () => socket.off('chat:message', onMessage);
  }, [socket]);

  useEffect(() => {
    if (joinCount === 0) return;
    const controller = new AbortController();
    getMessages(code, token, { signal: controller.signal })
      .then(({ messages }) => dispatch({ type: 'history', messages }))
      .catch((err) => {
        if (err.name !== 'AbortError') dispatch({ type: 'historyFailed', error: 'Couldn’t load earlier messages.' });
      });
    return () => controller.abort();
  }, [joinCount, code, token]);

  useEffect(() => {
    if (visible) dispatch({ type: 'markRead' });
  }, [visible, state.unread]);

  const deliver = useCallback(
    async (text, clientMsgId) => {
      try {
        if (!socket?.connected) throw new Error('offline');
        const ack = await socket.timeout(5000).emitWithAck('chat:send', { text, clientMsgId });
        if (ack.ok) dispatch({ type: 'confirmed', clientMsgId, message: ack.message });
        else dispatch({ type: 'failed', clientMsgId, error: ack.error.message });
      } catch {
        dispatch({ type: 'failed', clientMsgId, error: 'Not sent. Check your connection.' });
      }
    },
    [socket],
  );

  const send = useCallback(
    (text) => {
      if (!self) return;
      const clientMsgId = newClientMsgId();
      dispatch({
        type: 'pending',
        message: {
          clientMsgId,
          participantId: self.participantId,
          senderName: self.displayName,
          text,
          createdAt: new Date().toISOString(),
        },
      });
      deliver(text, clientMsgId);
    },
    [deliver, self],
  );

  const retry = useCallback(
    (clientMsgId) => {
      const message = state.messages.find((m) => m.clientMsgId === clientMsgId);
      if (!message) return;
      dispatch({ type: 'retrying', clientMsgId });
      deliver(message.text, clientMsgId);
    },
    [deliver, state.messages],
  );

  return { messages: state.messages, unread: state.unread, historyError: state.historyError, send, retry };
}
