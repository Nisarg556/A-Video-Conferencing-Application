import { Router } from 'express';
import { env } from '../../config/env.js';
import { requirePermission } from '../../lib/permissions.js';
import { requireParticipant } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  createMeetingLimiter,
  joinMeetingLimiter,
  lookupMeetingLimiter,
} from '../../middleware/rateLimit.js';
import { requireUser } from '../../middleware/session.js';
import { getRtcConfig } from '../../realtime/iceServers.js';
import {
  createMeetingSchema,
  historyQuerySchema,
  joinMeetingSchema,
  meetingCodeParamsSchema,
} from './meeting.schemas.js';
import * as meetingService from './meeting.service.js';

// Mounted at /api/meetings. req.user is set by loadUser when signed in.
export function createMeetingRouter({ rooms }) {
  const router = Router();

  const publicMeeting = (meeting, user) => ({
    ...meeting.toPublic(),
    participantCount: rooms.count(meeting.code),
    viewerIsHost: meeting.isHostedBy(user),
  });

  // POST /api/meetings (signed in) -> 201 { meeting, joinUrl } | 401 AUTH_REQUIRED
  router.post('/', requireUser, createMeetingLimiter, validate(createMeetingSchema), async (req, res) => {
    const meeting = await meetingService.createMeeting(req.validated.body, req.user);
    res.status(201).json({
      meeting: publicMeeting(meeting, req.user),
      joinUrl: `${env.CLIENT_URL}/m/${meeting.code}`,
    });
  });

  // GET /api/meetings/:code -> 200 { meeting } | 404
  // Ended/expired meetings still return 200 with status "ended" so the UI can
  // explain what happened instead of showing a generic "not found".
  router.get('/:code', lookupMeetingLimiter, validate(meetingCodeParamsSchema), async (req, res) => {
    const meeting = await meetingService.getMeetingByCode(req.validated.params.code, rooms);
    res.json({ meeting: publicMeeting(meeting, req.user) });
  });

  // POST /api/meetings/:code/join { displayName }
  //   -> 200 { participant, admission, token, rtcConfig, meeting }
  //   | 401 SIGN_IN_REQUIRED | 403 REMOVED_FROM_MEETING | 404 | 409 ROOM_FULL
  //   | 410 MEETING_ENDED | 423 MEETING_LOCKED
  router.post('/:code/join', joinMeetingLimiter, validate(joinMeetingSchema), async (req, res) => {
    const { meeting, participant, token } = await meetingService.joinMeeting(
      req.validated.params.code,
      req.validated.body,
      req.user,
      rooms,
    );
    res.json({
      participant: participant.toPublic(),
      admission: participant.status, // "admitted" | "waiting"
      token,
      rtcConfig: getRtcConfig(participant.id),
      meeting: publicMeeting(meeting, req.user),
    });
  });

  // POST /api/meetings/:code/end (participant token with meeting.end) -> 204
  router.post(
    '/:code/end',
    validate(meetingCodeParamsSchema),
    requireParticipant,
    requirePermission('meeting.end'),
    async (req, res) => {
      const meeting = await meetingService.getMeetingByCode(req.validated.params.code, rooms);
      await meetingService.endMeeting(meeting, 'host_ended');
      res.status(204).end();
    },
  );

  return router;
}

// Mounted at /api/me
export function createMeRouter() {
  const router = Router();

  // GET /api/me/meetings -> 200 { meetings } (hosted or attended while signed in)
  router.get('/meetings', requireUser, validate(historyQuerySchema), async (req, res) => {
    const meetings = await meetingService.listMeetingHistory(req.user, req.validated.query);
    res.json({ meetings });
  });

  return router;
}
