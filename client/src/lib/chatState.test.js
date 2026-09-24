import { describe, expect, it } from 'vitest';
import { chatReducer, initialChatState, validateDraft } from './chatState.js';

const me = 'p-me';
const serverMsg = (overrides) => ({
  id: 'm1',
  clientMsgId: 'c1',
  participantId: 'p-other',
  senderName: 'Bo',
  text: 'hi',
  createdAt: '2026-01-01T10:00:00.000Z',
  ...overrides,
});

function run(actions, state = initialChatState) {
  return actions.reduce(chatReducer, state);
}

describe('chatReducer', () => {
  it('shows my message immediately as pending, then replaces it with the server copy', () => {
    const pending = { clientMsgId: 'c-mine', participantId: me, senderName: 'Me', text: 'yo', createdAt: '2026-01-01T10:00:05.000Z' };
    const confirmed = serverMsg({ id: 'm-mine', clientMsgId: 'c-mine', participantId: me, senderName: 'Me', text: 'yo' });

    const afterSend = run([{ type: 'pending', message: pending }]);
    expect(afterSend.messages).toEqual([expect.objectContaining({ text: 'yo', status: 'pending' })]);

    const afterAck = chatReducer(afterSend, { type: 'confirmed', clientMsgId: 'c-mine', message: confirmed });
    expect(afterAck.messages).toEqual([expect.objectContaining({ id: 'm-mine', status: 'sent' })]);
  });

  it('marks a message failed and lets it be retried', () => {
    const pending = { clientMsgId: 'c-x', participantId: me, senderName: 'Me', text: 'hello', createdAt: '2026-01-01T10:00:00.000Z' };
    const failed = run([
      { type: 'pending', message: pending },
      { type: 'failed', clientMsgId: 'c-x', error: 'Not sent' },
    ]);
    expect(failed.messages[0]).toMatchObject({ status: 'failed', error: 'Not sent' });

    const retrying = chatReducer(failed, { type: 'retrying', clientMsgId: 'c-x' });
    expect(retrying.messages[0]).toMatchObject({ status: 'pending' });
    expect(retrying.messages[0].error).toBeUndefined();
  });

  it('does not duplicate a message that arrives both live and in history (reconnect re-sync)', () => {
    const msg = serverMsg();
    const state = run([
      { type: 'received', message: msg },
      { type: 'history', messages: [msg, serverMsg({ id: 'm0', clientMsgId: 'c0', createdAt: '2026-01-01T09:59:00.000Z' })] },
    ]);
    expect(state.messages.map((m) => m.id)).toEqual(['m0', 'm1']);
  });

  it('merges history with my still-pending message instead of showing it twice', () => {
    // Ack was lost, but the server did store it; history brings it back.
    const pending = { clientMsgId: 'c-lost', participantId: me, senderName: 'Me', text: 'x', createdAt: '2026-01-01T10:00:00.000Z' };
    const stored = serverMsg({ id: 'm-lost', clientMsgId: 'c-lost', participantId: me, senderName: 'Me', text: 'x' });
    const state = run([
      { type: 'pending', message: pending },
      { type: 'history', messages: [stored] },
    ]);
    expect(state.messages).toEqual([expect.objectContaining({ id: 'm-lost', status: 'sent' })]);
  });

  it('keeps messages in server time order with unsent ones at the end', () => {
    const state = run([
      { type: 'pending', message: { clientMsgId: 'c-p', participantId: me, senderName: 'Me', text: 'mine', createdAt: '2026-01-01T09:00:00.000Z' } },
      { type: 'received', message: serverMsg({ id: 'b', clientMsgId: 'cb', createdAt: '2026-01-01T10:00:02.000Z' }) },
      { type: 'received', message: serverMsg({ id: 'a', clientMsgId: 'ca', createdAt: '2026-01-01T10:00:01.000Z' }) },
    ]);
    expect(state.messages.map((m) => m.key)).toEqual(['a', 'b', 'c-p']);
  });

  it('counts unread messages only when asked, and resets on markRead', () => {
    const state = run([
      { type: 'received', message: serverMsg({ id: '1', clientMsgId: '1' }), countAsUnread: true },
      { type: 'received', message: serverMsg({ id: '2', clientMsgId: '2' }), countAsUnread: true },
      { type: 'received', message: serverMsg({ id: '3', clientMsgId: '3' }), countAsUnread: false },
    ]);
    expect(state.unread).toBe(2);
    expect(chatReducer(state, { type: 'markRead' }).unread).toBe(0);
  });
});

describe('validateDraft', () => {
  it.each([
    ['', { ok: false, reason: 'empty' }],
    ['   \n ', { ok: false, reason: 'empty' }],
    ['x'.repeat(1001), { ok: false, reason: 'too-long' }],
    ['  hi  ', { ok: true, text: 'hi' }],
  ])('%j', (input, expected) => {
    expect(validateDraft(input)).toEqual(expected);
  });
});
