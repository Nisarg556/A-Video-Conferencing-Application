import { apiRequest } from './http.js';

export function createMeeting({ title }) {
  return apiRequest('/meetings', { method: 'POST', body: { title } });
}

export function getMeeting(code, { signal } = {}) {
  return apiRequest(`/meetings/${encodeURIComponent(code)}`, { signal });
}

// -> { participant, token, iceServers, meeting }
export function joinMeeting(code, { displayName, hostKey }) {
  return apiRequest(`/meetings/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    body: { displayName, ...(hostKey && { hostKey }) },
  });
}

// -> { messages } oldest first; 410 once the meeting has ended (messages are deleted)
export function getMessages(code, token, { before, signal } = {}) {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  return apiRequest(`/meetings/${encodeURIComponent(code)}/messages${query}`, { token, signal });
}

export function endMeeting(code, token) {
  return apiRequest(`/meetings/${encodeURIComponent(code)}/end`, { method: 'POST', token });
}
