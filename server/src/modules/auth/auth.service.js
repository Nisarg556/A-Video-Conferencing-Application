import { AppError } from '../../lib/AppError.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../lib/passwords.js';
import { User } from '../users/user.model.js';

const DUPLICATE_KEY = 11000;

export async function registerUser({ name, email, password }) {
  try {
    return await User.create({ name, email, passwordHash: await hashPassword(password) });
  } catch (err) {
    if (err.code === DUPLICATE_KEY) throw AppError.conflict('EMAIL_TAKEN', 'An account with this email already exists');
    throw err;
  }
}

/** Same error for "no such email" and "wrong password", with equal timing. */
export async function authenticate({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');
  const valid = user ? await verifyPassword(password, user.passwordHash) : await burnPasswordCheck(password);
  if (!user || !valid) throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  return user;
}
