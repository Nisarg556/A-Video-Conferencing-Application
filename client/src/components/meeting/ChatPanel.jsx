import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CHAT_MAX_LENGTH, validateDraft } from '../../lib/chatState.js';
import { SendIcon } from '../icons.jsx';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const GROUP_WINDOW_MS = 2 * 60 * 1000;

/**
 * Chat for this meeting only. Text is rendered as plain text (React escapes
 * it), so a message like "<img onerror=…>" is shown literally, never run.
 */
export function ChatPanel({ chat, selfId, disabled, autoFocus }) {
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const stickToBottom = useRef(true);

  const validation = validateDraft(draft);
  const remaining = CHAT_MAX_LENGTH - draft.trim().length;

  // Opened via the Chat button: ready to type. Reached via the tab list: focus stays on the tab.
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the newest message in view, unless the user scrolled up to read.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [chat.messages]);

  function handleScroll() {
    const list = listRef.current;
    stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  }

  function submit(event) {
    event?.preventDefault();
    if (!validation.ok || disabled) return;
    chat.send(validation.text);
    setDraft('');
    stickToBottom.current = true;
  }

  function handleKeyDown(event) {
    // Enter sends, Shift+Enter adds a new line (IME composition is left alone).
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  }

  return (
    <div className="chat">
      <p className="chat-policy muted">Visible to everyone in this meeting. Deleted when the meeting ends.</p>

      {chat.historyError && (
        <p className="alert" role="status">
          {chat.historyError}
        </p>
      )}

      <ol ref={listRef} className="chat-messages" role="log" aria-live="polite" aria-label="Messages" onScroll={handleScroll}>
        {chat.messages.length === 0 ? (
          <li className="chat-empty">
            <p>No messages yet</p>
            <p className="muted">Say hi 👋</p>
          </li>
        ) : (
          chat.messages.map((message, i) => (
            <ChatMessage
              key={message.key}
              message={message}
              mine={message.participantId === selfId}
              grouped={isGrouped(chat.messages[i - 1], message)}
              onRetry={() => chat.retry(message.clientMsgId)}
            />
          ))
        )}
      </ol>

      <form className="chat-form" onSubmit={submit}>
        <label htmlFor="chat-input" className="sr-only">
          Message everyone
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          className="input chat-input"
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Reconnecting…' : 'Message everyone'}
          aria-describedby={remaining < 100 ? 'chat-remaining' : undefined}
          aria-invalid={validation.reason === 'too-long'}
        />
        <button
          type="submit"
          className="icon-button icon-button-primary"
          disabled={!validation.ok || disabled}
          aria-label="Send message"
          title="Send (Enter)"
        >
          <SendIcon />
        </button>
        {remaining < 100 && (
          <p id="chat-remaining" className={`chat-remaining ${remaining < 0 ? 'error-text' : 'muted'}`}>
            {remaining < 0 ? `${-remaining} characters over the limit` : `${remaining} characters left`}
          </p>
        )}
      </form>
    </div>
  );
}

function isGrouped(previous, message) {
  return (
    previous &&
    previous.participantId === message.participantId &&
    new Date(message.createdAt) - new Date(previous.createdAt) < GROUP_WINDOW_MS
  );
}

function ChatMessage({ message, mine, grouped, onRetry }) {
  return (
    <li className={`chat-message ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''} ${message.status}`}>
      {!grouped && (
        <div className="chat-meta">
          <span className="chat-sender">{mine ? 'You' : message.senderName}</span>
          <time dateTime={message.createdAt}>{timeFormat.format(new Date(message.createdAt))}</time>
        </div>
      )}
      <p className="chat-text">{message.text}</p>
      {message.status === 'pending' && <span className="chat-state muted">Sending…</span>}
      {message.status === 'failed' && (
        <span className="chat-state error-text" role="alert">
          {message.error}{' '}
          <button type="button" className="link-button" onClick={onRetry}>
            Retry
          </button>
        </span>
      )}
    </li>
  );
}
