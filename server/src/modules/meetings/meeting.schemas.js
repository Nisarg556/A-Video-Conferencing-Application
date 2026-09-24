import { z } from 'zod';
import { MEETING_CODE_REGEX } from '../../lib/crypto.js';
import { MEETING_TITLE_MAX } from './meeting.model.js';
import { DISPLAY_NAME_MAX } from './participant.model.js';

const meetingCodeParams = z.object({
  // Accept "KQZ-MTRW-XPA" or " kqz-mtrw-xpa " from a pasted link.
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(MEETING_CODE_REGEX, 'Meeting code must look like abc-defg-hij'),
});

export const createMeetingSchema = {
  body: z
    .object({
      title: z
        .string()
        .trim()
        .max(MEETING_TITLE_MAX, `Title must be at most ${MEETING_TITLE_MAX} characters`)
        .optional()
        .default(''),
    })
    .strict(),
};

export const meetingCodeParamsSchema = {
  params: meetingCodeParams,
};

export const joinMeetingSchema = {
  params: meetingCodeParams,
  body: z
    .object({
      displayName: z
        .string({ required_error: 'Display name is required' })
        .trim()
        .min(1, 'Display name is required')
        .max(DISPLAY_NAME_MAX, `Display name must be at most ${DISPLAY_NAME_MAX} characters`)
        // Block control and invisible formatting characters (e.g. zero-width
        // spaces) that could be used to spoof another participant's name.
        .regex(/^[^\p{Cc}\p{Cf}]+$/u, 'Display name contains invalid characters'),
      hostKey: z.string().min(1).max(128).optional(),
    })
    .strict(),
};
