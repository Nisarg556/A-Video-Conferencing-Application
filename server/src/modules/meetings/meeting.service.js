import { AppError } from '../../lib/AppError.js';
import { generateMeetingCode, generateSecret, sha256 } from '../../lib/crypto.js';
import { Meeting } from './meeting.model.js';

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

export async function getMeetingByCode(code) {
  const meeting = await Meeting.findOne({ code });
  if (!meeting) throw AppError.notFound('Meeting not found');
  return meeting;
}
