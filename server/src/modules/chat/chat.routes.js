import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/AppError.js';
import { requireParticipant } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { meetingCodeParamsSchema } from '../meetings/meeting.schemas.js';
import { assertMeetingActive, getMeetingByCode } from '../meetings/meeting.service.js';
import { Participant } from '../meetings/participant.model.js';
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

  // GET -> 200 { messages } (oldest first). Only ADMITTED participants of THIS
  // meeting can read, and only while it is active. A token alone isn't enough:
  // people in the waiting room, denied or removed also hold one.
  router.get('/', validate(listMessagesSchema), requireParticipant, async (req, res) => {
    const meeting = await getMeetingByCode(req.validated.params.code, rooms);
    assertMeetingActive(meeting);
    const participant = await Participant.findOne({ _id: req.participant.participantId, meetingId: meeting._id });
    if (participant?.status !== 'admitted') {
      throw AppError.forbidden('Only people admitted to the meeting can read its chat', 'NOT_ADMITTED');
    }
    const messages = await listMessages(meeting._id, req.validated.query);
    res.json({ messages: messages.map((m) => m.toPublic()) });
  });

  return router;
}
