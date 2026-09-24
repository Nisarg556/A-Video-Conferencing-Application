import { Router } from 'express';
import { env } from '../../config/env.js';
import { requireHost, requireParticipant } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  createMeetingLimiter,
  joinMeetingLimiter,
  lookupMeetingLimiter,
} from '../../middleware/rateLimit.js';
import { getIceServers } from '../../realtime/iceServers.js';
import { createMeetingSchema, joinMeetingSchema, meetingCodeParamsSchema } from './meeting.schemas.js';
import * as meetingService from './meeting.service.js';

export function createMeetingRouter({ rooms }) {
  const router = Router();

  const publicMeeting = (meeting) => ({
    ...meeting.toPublic(),
    participantCount: rooms.count(meeting.code),
  });

  // POST /api/meetings -> 201 { meeting, joinUrl, hostKey }
  router.post('/', createMeetingLimiter, validate(createMeetingSchema), async (req, res) => {
    const { meeting, hostKey } = await meetingService.createMeeting(req.validated.body);
    res.status(201).json({
      meeting: publicMeeting(meeting),
      joinUrl: `${env.CLIENT_URL}/m/${meeting.code}`,
      // Returned exactly once; only its hash is stored.
      hostKey,
    });
  });

  // GET /api/meetings/:code -> 200 { meeting } | 404
  // Ended/expired meetings still return 200 with status "ended" so the UI can
  // explain what happened instead of showing a generic "not found".
  router.get('/:code', lookupMeetingLimiter, validate(meetingCodeParamsSchema), async (req, res) => {
    const meeting = await meetingService.getMeetingByCode(req.validated.params.code, rooms);
    res.json({ meeting: publicMeeting(meeting) });
  });

  // POST /api/meetings/:code/join -> 200 { participant, token, iceServers, meeting }
  //   | 403 INVALID_HOST_KEY | 404 | 409 ROOM_FULL | 410 MEETING_ENDED
  router.post('/:code/join', joinMeetingLimiter, validate(joinMeetingSchema), async (req, res) => {
    const { meeting, participant, token } = await meetingService.joinMeeting(
      req.validated.params.code,
      req.validated.body,
      rooms,
    );
    res.json({
      participant: participant.toPublic(),
      token,
      iceServers: getIceServers(),
      meeting: publicMeeting(meeting),
    });
  });

  // POST /api/meetings/:code/end (host token) -> 204; everyone is disconnected.
  router.post(
    '/:code/end',
    validate(meetingCodeParamsSchema),
    requireParticipant,
    requireHost,
    async (req, res) => {
      const meeting = await meetingService.getMeetingByCode(req.validated.params.code, rooms);
      await meetingService.endMeeting(meeting, 'host_ended');
      res.status(204).end();
    },
  );

  return router;
}
