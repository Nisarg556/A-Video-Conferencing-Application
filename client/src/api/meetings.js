import { apiRequest } from './http.js';

export function createMeeting({ title }) {
  return apiRequest('/meetings', { method: 'POST', body: { title } });
}

export function getMeeting(code, { signal } = {}) {
  return apiRequest(`/meetings/${encodeURIComponent(code)}`, { signal });
}
