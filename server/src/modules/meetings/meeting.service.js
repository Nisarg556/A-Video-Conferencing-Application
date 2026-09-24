import { AppError } from '../../lib/AppError.js';
import { generateMeetingCode, generateSecret, safeEqual, sha256 } from '../../lib/crypto.js';
import { meetingEvents } from '../../lib/events.js';
import { signParticipantToken } from '../../lib/tokens.js';
import { ENDED_MEETING_RETENTION_MS, MEETING_IDLE_TTL_MS, Meeting } from './meeting.model.js';
import { Participant } from './participant.model.js';

const DUPLICATE_KEY = 11000;
const MAX_CODE_ATTEMPTS = 5;

export async function createMeeting({ title }) {
  const hostKey = generateSecret();

  // Collisions are astronomically unlikely at 47 bits, but the unique index is
  // the real guarantee — retry instead of assuming.
  for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
    try {
      const meeting = await Meeting.create({
        code: generateMeetingCode(),
        title,
        hostKeyHash: sha256(hostKey),
      });
      return { meeting, hostKey };
    } catch (err) {
      if (err.code !== DUPLICATE_KEY || attempt === MAX_CODE_ATTEMPTS) throw err;
    }
  }
}

/**
 * Looks up a meeting and lazily expires it if it has sat empty for too long.
 * Checking on read (instead of a cron job) means expiry still works after a
 * server restart wipes in-memory timers.
 */
export async function getMeetingByCode(code, rooms, { withHostKey = false } = {}) {
  const query = Meeting.findOne({ code });
  if (withHostKey) query.select('+hostKeyHash');
  const meeting = await query;
  if (!meeting) throw AppError.notFound('Meeting not found');

  const idleFor = Date.now() - meeting.lastActiveAt.getTime();
  if (meeting.status === 'active' && rooms.count(code) === 0 && idleFor > MEETING_IDLE_TTL_MS) {
    await endMeeting(meeting, 'expired');
  }
  return meeting;
}

export async function endMeeting(meeting, reason) {
  if (meeting.status === 'ended') return meeting;
  const now = new Date();
  meeting.status = 'ended';
  meeting.endedReason = reason;
  meeting.endedAt = now;
  meeting.expiresAt = new Date(now.getTime() + ENDED_MEETING_RETENTION_MS);
  await meeting.save();
  meetingEvents.emit('ended', { code: meeting.code, reason });
  return meeting;
}

export function assertMeetingActive(meeting) {
  if (meeting.status !== 'active') {
    throw AppError.gone(
      'MEETING_ENDED',
      meeting.endedReason === 'expired' ? 'This meeting link has expired' : 'This meeting has ended',
    );
  }
}

/**
 * Validates a join request and issues a participant token. The capacity check
 * here is for fast feedback only; the authoritative check happens when the
 * socket actually joins the room (two people could pass this check at once).
 */
export async function joinMeeting(code, { displayName, hostKey }, rooms) {
  const meeting = await getMeetingByCode(code, rooms, { withHostKey: true });
  assertMeetingActive(meeting);

  let role = 'guest';
  if (hostKey !== undefined) {
    if (!safeEqual(sha256(hostKey), meeting.hostKeyHash)) {
      throw AppError.forbidden('Invalid host key', 'INVALID_HOST_KEY');
    }
    role = 'host';
  }

  if (rooms.count(code) >= meeting.maxParticipants) {
    throw AppError.conflict('ROOM_FULL', `This meeting is full (max ${meeting.maxParticipants} people)`);
  }

  const participant = await Participant.create({ meetingId: meeting._id, displayName, role });
  const token = signParticipantToken({
    participantId: participant.id,
    meetingId: meeting.id,
    code: meeting.code,
    role,
    displayName,
  });

  return { meeting, participant, token };
}

export async function touchMeeting(meetingId) {
  await Meeting.updateOne({ _id: meetingId }, { lastActiveAt: new Date() });
}
