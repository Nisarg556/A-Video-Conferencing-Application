const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

// Mirrors the server's error shape: { error: { code, message, details? } }.
// status 0 means the request never got a response (server down, offline).
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiRequest(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`${BASE_URL}/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection.');
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = data?.error;
    if (!error) {
      // Non-JSON failure, e.g. the dev proxy can't reach Express.
      throw new ApiError(res.status, 'NETWORK_ERROR', 'The server is unavailable. Is it running?');
    }
    throw new ApiError(res.status, error.code, error.message, error.details);
  }

  return data;
}
