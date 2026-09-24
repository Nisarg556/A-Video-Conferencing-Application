import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getRtcConfig, TURN_CREDENTIAL_TTL_SECONDS } from '../src/realtime/iceServers.js';

const base = {
  STUN_URLS: ['stun:stun.example.com:3478'],
  TURN_URLS: [],
  ICE_TRANSPORT_POLICY: 'all',
};

describe('getRtcConfig', () => {
  it('returns STUN only when no TURN is configured', () => {
    expect(getRtcConfig('p1', base)).toEqual({
      iceServers: [{ urls: ['stun:stun.example.com:3478'] }],
      iceTransportPolicy: 'all',
    });
  });

  it('mints short-lived, per-participant TURN credentials from TURN_SECRET', () => {
    const now = Date.UTC(2026, 0, 1);
    const config = { ...base, TURN_URLS: ['turn:turn.example.com:3478'], TURN_SECRET: 'shared-secret' };

    const { iceServers } = getRtcConfig('participant-42', config, now);
    const turn = iceServers[1];

    const expiry = now / 1000 + TURN_CREDENTIAL_TTL_SECONDS;
    expect(turn.username).toBe(`${expiry}:participant-42`);
    // Exactly what coturn computes with use-auth-secret / static-auth-secret.
    expect(turn.credential).toBe(createHmac('sha1', 'shared-secret').update(turn.username).digest('base64'));
    expect(JSON.stringify(iceServers)).not.toContain('shared-secret');
  });

  it('passes static TURN credentials through when no secret is set', () => {
    const config = {
      ...base,
      TURN_URLS: ['turns:relay.example.com:443?transport=tcp'],
      TURN_USERNAME: 'user',
      TURN_CREDENTIAL: 'pass',
    };
    expect(getRtcConfig('p1', config).iceServers[1]).toEqual({
      urls: ['turns:relay.example.com:443?transport=tcp'],
      username: 'user',
      credential: 'pass',
    });
  });

  it('can force all media through TURN', () => {
    const config = { ...base, TURN_URLS: ['turn:t:3478'], TURN_SECRET: 's', ICE_TRANSPORT_POLICY: 'relay' };
    expect(getRtcConfig('p1', config).iceTransportPolicy).toBe('relay');
  });
});
