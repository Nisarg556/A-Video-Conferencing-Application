import { createHash, randomBytes, randomInt } from 'node:crypto';

// Meeting codes look like "kqz-mtrw-xpa": 10 random letters = 26^10 ≈ 47 bits,
// generated with a CSPRNG so codes can't be predicted or enumerated cheaply.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const GROUPS = [3, 4, 3];

export const MEETING_CODE_REGEX = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

export function generateMeetingCode() {
  return GROUPS.map((len) =>
    Array.from({ length: len }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''),
  ).join('-');
}

// High-entropy secret shown to the creator once (e.g. the host key).
export function generateSecret(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

// SHA-256 is enough here because the input is a random 192-bit secret, not a
// human-chosen password — there is nothing to brute-force, so bcrypt's
// deliberate slowness buys nothing.
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
