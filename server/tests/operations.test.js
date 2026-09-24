import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createLogger, redactUri } from '../src/lib/logger.js';
import { startTestDb } from './helpers.js';

let stopDb;

beforeAll(async () => {
  stopDb = await startTestDb();
});

afterAll(async () => {
  await stopDb?.();
});

/** A logger that writes JSON lines into an array we can inspect. */
function captureLogger() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(...chunk.toString().trim().split('\n').map((l) => JSON.parse(l)));
      done();
    },
  });
  return { logger: createLogger({ level: 'info' }, stream), lines };
}

describe('structured logging', () => {
  it('logs one JSON line per API request with a request id that is echoed to the client', async () => {
    const { logger, lines } = captureLogger();
    const app = createApp({ logger });

    const res = await request(app).get('/api/meetings/aaa-bbbb-ccc').set('X-Request-Id', 'trace-123');
    expect(res.headers['x-request-id']).toBe('trace-123');

    const entry = lines.find((l) => l.req?.url === '/api/meetings/aaa-bbbb-ccc');
    expect(entry).toMatchObject({ level: 40, req: { id: 'trace-123' }, res: { statusCode: 404 }, service: 'confer-api' });
  });

  it('ignores unsafe incoming request ids', async () => {
    const app = createApp({ logger: captureLogger().logger });
    const res = await request(app).get('/api/health').set('X-Request-Id', 'bad id <script>');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('never writes tokens, cookies or passwords to the log', async () => {
    const { logger, lines } = captureLogger();
    const app = createApp({ logger });

    await request(app)
      .post('/api/auth/login')
      .set('Authorization', 'Bearer super-secret-token')
      .set('Cookie', 'confer_session=super-secret-cookie')
      .send({ email: 'a@example.com', password: 'super-secret-password' });

    const output = JSON.stringify(lines);
    expect(output).not.toContain('super-secret');
    expect(output).not.toContain('user-agent'); // request lines stay lean
  });

  it('redacts secrets even if code logs a whole request or body by mistake', () => {
    const { logger, lines } = captureLogger();
    logger.info({
      req: { headers: { authorization: 'Bearer leaked', cookie: 'confer_session=leaked' } },
      body: { password: 'leaked', token: 'leaked' },
    });
    expect(JSON.stringify(lines)).not.toContain('leaked');
    expect(lines[0].req.headers).toEqual({ authorization: '[redacted]', cookie: '[redacted]' });
  });

  it('strips credentials from database URIs', () => {
    expect(redactUri('mongodb+srv://ada:hunter2@cluster0.example.net/confer')).toBe(
      'mongodb+srv://***@cluster0.example.net/confer',
    );
    expect(redactUri('mongodb://127.0.0.1:27017/confer')).toBe('mongodb://127.0.0.1:27017/confer');
  });
});

describe('security headers', () => {
  it('restricts camera/mic/screen to this site and sets a CSP that allows only our own WebSocket', async () => {
    const res = await request(createApp({ logger: captureLogger().logger })).get('/api/health');
    expect(res.headers['permissions-policy']).toBe(
      'camera=(self), microphone=(self), display-capture=(self), geolocation=()',
    );
    expect(res.headers['content-security-policy']).toContain("connect-src 'self' ws://localhost:5173");
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('serving the built client (production, single origin)', () => {
  let app;

  beforeAll(() => {
    const dist = mkdtempSync(path.join(tmpdir(), 'confer-dist-'));
    mkdirSync(path.join(dist, 'assets'));
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
    writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
    app = createApp({ logger: captureLogger().logger, clientDist: dist });
  });

  it('serves index.html for client-side routes, never cached', async () => {
    for (const url of ['/', '/m/abc-defg-hij', '/meetings']) {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.text).toContain('<div id="root">');
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('caches hashed assets for a year', async () => {
    const res = await request(app).get('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('keeps unknown API routes as JSON 404s instead of returning the SPA', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
