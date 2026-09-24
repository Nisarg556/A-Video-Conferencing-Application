import { Router } from 'express';
import { env } from '../../config/env.js';
import { validate } from '../../middleware/validate.js';
import { createMeetingLimiter, lookupMeetingLimiter } from '../../middleware/rateLimit.js';
import { createMeetingSchema, meetingCodeParamsSchema } from './meeting.schemas.js';
import * as meetingService from './meeting.service.js';

export const meetingRouter = Router();

// POST /api/meetings -> 201 { meeting, joinUrl, hostKey }
meetingRouter.post(
  '/',
  createMeetingLimiter,
  validate(createMeetingSchema),
  async (req, res) => {
    const { meeting, hostKey } = await meetingService.createMeeting(req.validated.body);
    res.status(201).json({
      meeting: meeting.toPublic(),
      joinUrl: `${env.CLIENT_URL}/m/${meeting.code}`,
      // Returned exactly once; only its hash is stored.
      hostKey,
    });
  },
);

// GET /api/meetings/:code -> 200 { meeting } | 404
meetingRouter.get(
  '/:code',
  lookupMeetingLimiter,
  validate(meetingCodeParamsSchema),
  async (req, res) => {
    const meeting = await meetingService.getMeetingByCode(req.validated.params.code);
    res.json({ meeting: meeting.toPublic() });
  },
);
