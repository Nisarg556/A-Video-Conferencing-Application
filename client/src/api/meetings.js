import { apiRequest } from './http.js';

// Signed-in only. settings: { allowGuests?, waitingRoom? }
export function createMeeting({ title, settings }) {
  return apiRequest('/meetings', { method: 'POST', body: { title, settings } });
}

export function getMeeting(code, { signal } = {}) {
  return apiRequest(`/meetings/${encodeURIComponent(code)}`, { signal });
}

// -> { participant, admission: 'admitted' | 'waiting', token, rtcConfig, meeting }
// The server decides the role from the session cookie (host / member / guest).
export function joinMeeting(code, { displayName }) {
  return apiRequest(`/meetings/${encodeURIComponent(code)}/join`, { method: 'POST', body: { displayName } });
}

// -> { meetings } hosted or attended while signed in
export function getMeetingHistory({ signal } = {}) {
  return apiRequest('/me/meetings', { signal });
}

// -> { messages } oldest first; 410 once the meeting has ended (messages are deleted)
export function getMessages(code, token, { before, signal } = {}) {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  return apiRequest(`/meetings/${encodeURIComponent(code)}/messages${query}`, { token, signal });
}

export function endMeeting(code, token) {
  return apiRequest(`/meetings/${encodeURIComponent(code)}/end`, { method: 'POST', token });
}
