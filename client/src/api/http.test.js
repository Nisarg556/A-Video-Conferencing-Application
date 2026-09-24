import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from './http.js';

vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } });

afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl) {
  vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } });
  vi.stubGlobal('fetch', vi.fn(impl));
}

describe('apiRequest error mapping', () => {
  it('nothing listening (dev server stopped): says which server and how to start it on Windows', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const err = await apiRequest('/meetings', { method: 'POST', body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    expect(err.message).toContain('http://localhost:5173');
    expect(err.message).toContain('npm.cmd run dev');
  });

  it('Vite up but the API down (proxy answers a bare 500): points at the [server] logs', async () => {
    stubFetch(() => Promise.resolve(new Response('', { status: 500 })));
    const err = await apiRequest('/meetings').catch((e) => e);
    expect(err).toMatchObject({ status: 500, code: 'SERVER_UNAVAILABLE' });
    expect(err.message).toContain('[server]');
  });

  it('passes through the API’s own error shape', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to do that' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const err = await apiRequest('/meetings', { method: 'POST', body: {} }).catch((e) => e);
    expect(err).toMatchObject({ status: 401, code: 'AUTH_REQUIRED', message: 'Sign in to do that' });
  });

  it('does not turn a cancelled request into an error message', async () => {
    stubFetch(() => Promise.reject(new DOMException('aborted', 'AbortError')));
    await expect(apiRequest('/meetings')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
