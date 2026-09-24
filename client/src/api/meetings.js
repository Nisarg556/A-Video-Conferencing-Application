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

export function endMeeting(code, token) {
  return apiRequest(`/meetings/${encodeURIComponent(code)}/end`, { method: 'POST', token });
}
