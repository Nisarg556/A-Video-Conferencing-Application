import { randomInt } from 'node:crypto';

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
