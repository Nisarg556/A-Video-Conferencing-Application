import { Router } from 'express';
import { z } from 'zod';
import { requireParticipant } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { meetingCodeParamsSchema } from '../meetings/meeting.schemas.js';
import { assertMeetingActive, getMeetingByCode } from '../meetings/meeting.service.js';
import { listMessages } from './chat.service.js';

const listMessagesSchema = {
  ...meetingCodeParamsSchema,
  query: z.object({
    before: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
};

// Mounted at /api/meetings/:code/messages
export function createChatRouter({ rooms }) {
  const router = Router({ mergeParams: true });

  // GET -> 200 { messages } (oldest first). Only participants of THIS meeting
  // (valid token for its code) can read, and only while it is active.
  router.get('/', validate(listMessagesSchema), requireParticipant, async (req, res) => {
    const meeting = await getMeetingByCode(req.validated.params.code, rooms);
    assertMeetingActive(meeting);
    const messages = await listMessages(meeting._id, req.validated.query);
    res.json({ messages: messages.map((m) => m.toPublic()) });
  });

  return router;
}
