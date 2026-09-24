import { AppError } from '../../lib/AppError.js';
import { generateMeetingCode } from '../../lib/crypto.js';
import { meetingEvents } from '../../lib/events.js';
import { signParticipantToken } from '../../lib/tokens.js';
import { deleteMessagesForMeeting } from '../chat/chat.service.js';
import { ENDED_MEETING_RETENTION_MS, MEETING_IDLE_TTL_MS, Meeting } from './meeting.model.js';
import { Participant } from './participant.model.js';

const DUPLICATE_KEY = 11000;
const MAX_CODE_ATTEMPTS = 5;

/** Only signed-in users create meetings; the creator is the host. */
export async function createMeeting({ title, settings }, user) {
  // Collisions are astronomically unlikely at 47 bits, but the unique index is
  // the real guarantee — retry instead of assuming.
  for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
    try {
      return await Meeting.create({
        code: generateMeetingCode(),
        title,
        hostUserId: user._id,
        hostName: user.name,
        settings,
      });
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
export async function getMeetingByCode(code, rooms, { withBans = false } = {}) {
  const query = Meeting.findOne({ code });
  if (withBans) query.select('+bannedUserIds');
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
  // Chat policy: messages live only as long as the meeting.
  await deleteMessagesForMeeting(meeting._id);
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

/** host = the owner; member = any other signed-in user; guest = not signed in. */
export function roleFor(meeting, user) {
  if (!user) return 'guest';
  return meeting.isHostedBy(user) ? 'host' : 'member';
}

/**
 * The join policy. Decides the role and whether the person is admitted or
 * must wait, then issues a participant token. Errors, in order:
 *   403 REMOVED_FROM_MEETING  signed-in user the host removed earlier
 *   401 SIGN_IN_REQUIRED      guest, but the host disallowed guests
 *   423 MEETING_LOCKED        host locked the meeting
 *   409 ROOM_FULL             no seat (only checked for admitted people)
 * The host is never blocked by the lock, the guest setting or the waiting room.
 * The capacity check here is fast feedback; the socket join re-checks it.
 */
export async function joinMeeting(code, { displayName }, user, rooms) {
  const meeting = await getMeetingByCode(code, rooms, { withBans: true });
  assertMeetingActive(meeting);
  const role = roleFor(meeting, user);

  if (role !== 'host') {
    if (user && meeting.bannedUserIds.some((id) => id.equals(user._id))) {
      throw AppError.forbidden('The host removed you from this meeting', 'REMOVED_FROM_MEETING');
    }
    if (role === 'guest' && !meeting.settings.allowGuests) {
      throw AppError.unauthorized('The host requires participants to sign in', 'SIGN_IN_REQUIRED');
    }
    if (meeting.settings.locked) {
      throw AppError.locked('MEETING_LOCKED', 'The host has locked this meeting');
    }
  }

  const admitted = role === 'host' || !meeting.settings.waitingRoom;
  if (admitted && !rooms.hasSeatFor(code, role, meeting.maxParticipants)) {
    throw AppError.conflict('ROOM_FULL', `This meeting is full (max ${meeting.maxParticipants} people)`);
  }

  const participant = await Participant.create({
    meetingId: meeting._id,
    userId: user?._id,
    displayName,
    role,
    status: admitted ? 'admitted' : 'waiting',
    ...(admitted && { admittedBy: 'auto', admittedAt: new Date() }),
  });
  const token = signParticipantToken({
    participantId: participant.id,
    meetingId: meeting.id,
    code: meeting.code,
    role,
    displayName,
  });

  return { meeting, participant, token };
}

/** Meetings the user hosted or entered while signed in, newest first. */
export async function listMeetingHistory(user, { limit }) {
  const attendedIds = await Participant.distinct('meetingId', { userId: user._id, enteredAt: { $ne: null } });
  const meetings = await Meeting.find({ $or: [{ hostUserId: user._id }, { _id: { $in: attendedIds } }] })
    .sort({ createdAt: -1 })
    .limit(limit);

  // How many people actually entered each meeting (one aggregate query).
  const counts = await Participant.aggregate([
    { $match: { meetingId: { $in: meetings.map((m) => m._id) }, enteredAt: { $ne: null } } },
    { $group: { _id: '$meetingId', count: { $sum: 1 } } },
  ]);
  const countById = new Map(counts.map((c) => [c._id.toString(), c.count]));

  return meetings.map((meeting) => ({
    ...meeting.toPublic(),
    role: meeting.isHostedBy(user) ? 'host' : 'member',
    attendeeCount: countById.get(meeting.id) ?? 0,
  }));
}

export async function updateSettings(meetingId, changes) {
  const $set = Object.fromEntries(Object.entries(changes).map(([key, value]) => [`settings.${key}`, value]));
  const meeting = await Meeting.findOneAndUpdate({ _id: meetingId, status: 'active' }, { $set }, { new: true });
  if (!meeting) throw AppError.gone('MEETING_ENDED', 'This meeting has ended');
  return meeting;
}

export async function touchMeeting(meetingId) {
  await Meeting.updateOne({ _id: meetingId }, { lastActiveAt: new Date() });
}
