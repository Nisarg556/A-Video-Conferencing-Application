import { describe, expect, it } from 'vitest';
import { safeNextPath } from './redirect.js';

describe('safeNextPath (post-login redirect)', () => {
  it.each([
    ['/m/abc-defg-hij', '/m/abc-defg-hij'],
    ['/meetings?x=1', '/meetings?x=1'],
  ])('allows local path %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    'https://evil.example/phish',
    '//evil.example/phish', // protocol-relative: leaves the site
    '/\\evil.example', // some browsers treat "/\" like "//"
    'javascript:alert(1)',
    '/login',
    '/signup?next=/login', // would loop
    null,
    undefined,
  ])('falls back to "/" for %s', (input) => {
    expect(safeNextPath(input)).toBe('/');
  });
});
