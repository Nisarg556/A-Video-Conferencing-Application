import { z } from 'zod';
import { USER_NAME_MAX } from '../users/user.model.js';

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

export const registerSchema = {
  body: z
    .object({
      name: z
        .string({ required_error: 'Name is required' })
        .trim()
        .min(1, 'Name is required')
        .max(USER_NAME_MAX, `Name must be at most ${USER_NAME_MAX} characters`)
        .regex(/^[^\p{Cc}\p{Cf}]+$/u, 'Name contains invalid characters'),
      email,
      // Upper bound stops someone making the server hash megabytes of input.
      password: z
        .string({ required_error: 'Password is required' })
        .min(8, 'Password must be at least 8 characters')
        .max(128, 'Password must be at most 128 characters'),
    })
    .strict(),
};

export const loginSchema = {
  body: z
    .object({
      email,
      password: z.string().min(1, 'Password is required').max(128),
    })
    .strict(),
};
