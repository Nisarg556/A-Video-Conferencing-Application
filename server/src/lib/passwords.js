import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

// scrypt is a memory-hard password hash built into Node, so no native
// dependency is needed. Stored as "scrypt$<salt>$<hash>" (base64).
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

// Used when the email doesn't exist, so a login attempt takes the same time
// either way and response timing can't reveal which emails have accounts.
const DUMMY_HASH = await hashPassword('timing-equalizer');
export function burnPasswordCheck(password) {
  return verifyPassword(password, DUMMY_HASH);
}
