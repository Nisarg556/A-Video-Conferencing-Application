import { z } from 'zod';
import { CHAT_MAX_LENGTH } from '../modules/chat/message.model.js';

// Real SDP for one audio + one video transceiver is ~3–10 KB; the cap stops
// anyone using the relay to push large payloads through other participants.
export const MAX_SDP_LENGTH = 64 * 1024;

const participantId = z.string().regex(/^[a-f0-9]{24}$/, 'Invalid participant id');
// Chosen by the offering client, one per peer connection (see signaling notes).
const connectionId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid connection id');

export const mediaStateSchema = z.object({
  audio: z.boolean(),
  video: z.boolean(),
});

export const joinPayloadSchema = z
  .object({ media: mediaStateSchema.default({ audio: false, video: false }) })
  .default({});

// Chat text: newlines and tabs are fine; other control characters and bidi
// overrides (which can make text display differently from what was sent) are not.
// Emoji joiners (U+200D) are allowed, so family/skin-tone emoji still work.
const CHAT_TEXT_ALLOWED = /^(?:[^\p{Cc}‪-‮⁦-⁩]|[\n\t])*$/u;

export const chatSendSchema = z.object({
  text: z
    .string()
    .transform((text) => text.replace(/\r\n?/g, '\n').trim())
    .pipe(
      z
        .string()
        .min(1, 'Message is empty')
        .max(CHAT_MAX_LENGTH, `Messages can be at most ${CHAT_MAX_LENGTH} characters`)
        .regex(CHAT_TEXT_ALLOWED, 'Message contains invalid characters'),
    ),
  clientMsgId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid clientMsgId'),
});

const description = (type) =>
  z.object({
    type: z.literal(type),
    to: participantId,
    connectionId,
    sdp: z.string().min(1).max(MAX_SDP_LENGTH),
  });

// Unknown keys (like a spoofed "from") are stripped, never forwarded.
export const signalSchema = z.discriminatedUnion('type', [
  description('offer'),
  description('answer'),
  z.object({
    type: z.literal('candidate'),
    to: participantId,
    connectionId,
    candidate: z.object({
      candidate: z.string().max(2048),
      sdpMid: z.string().max(64).nullish(),
      sdpMLineIndex: z.number().int().min(0).max(255).nullish(),
      usernameFragment: z.string().max(256).nullish(),
    }),
  }),
]);
