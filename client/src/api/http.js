export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

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

// In development, say exactly which process is down and how to start it —
// "check your connection" is useless when the problem is a stopped dev server.
const START_HINT = 'Start it with “npm run dev” (Windows PowerShell: “npm.cmd run dev”) and keep that terminal open.';

export function unreachableMessage(isDev = import.meta.env.DEV) {
  return isDev
    ? `Can’t reach the dev server at ${window.location.origin}. ${START_HINT}`
    : 'Could not reach the server. Check your connection and try again.';
}

export function apiDownMessage(isDev = import.meta.env.DEV) {
  return isDev
    ? `The web app is running but the API server isn’t responding (expected on port 4000). Check the [server] lines in the “npm run dev” terminal for an error such as MongoDB not running.`
    : 'The server is temporarily unavailable. Please try again in a moment.';
}

export async function apiRequest(path, { method = 'GET', body, token, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE_URL}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // Send the httpOnly session cookie (same-origin in dev; see README for production).
      credentials: 'include',
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // The request never got an answer: nothing is listening (dev server
    // stopped), or the device is offline.
    throw new ApiError(0, 'NETWORK_ERROR', unreachableMessage());
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = data?.error;
    if (!error) {
      // Non-JSON failure: in development, Vite's proxy answers 500 when it
      // can't reach Express (API crashed or not started); in production a
      // load balancer error page.
      throw new ApiError(res.status, 'SERVER_UNAVAILABLE', apiDownMessage());
    }
    throw new ApiError(res.status, error.code, error.message, error.details);
  }

  return data;
}
