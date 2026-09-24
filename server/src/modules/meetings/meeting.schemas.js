import { z } from 'zod';
import { MEETING_CODE_REGEX } from '../../lib/crypto.js';
import { MEETING_TITLE_MAX } from './meeting.model.js';

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
  params: z.object({
    // Accept "KQZ-MTRW-XPA" or " kqz-mtrw-xpa " from a pasted link.
    code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(MEETING_CODE_REGEX, 'Meeting code must look like abc-defg-hij'),
  }),
};
