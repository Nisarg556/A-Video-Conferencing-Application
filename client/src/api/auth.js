import { apiRequest } from './http.js';

// The session lives in an httpOnly cookie set by the server; the client never
// sees or stores the token itself.

export function register({ name, email, password }) {
  return apiRequest('/auth/register', { method: 'POST', body: { name, email, password } });
}

export function login({ email, password }) {
  return apiRequest('/auth/login', { method: 'POST', body: { email, password } });
}

export function logout() {
  return apiRequest('/auth/logout', { method: 'POST' });
}

export function getMe() {
  return apiRequest('/auth/me');
}
