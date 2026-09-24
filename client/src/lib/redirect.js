/**
 * Only allow redirecting back to a path on this site. "?next=//evil.com" or
 * "?next=https://evil.com" would otherwise be an open redirect.
 */
export function safeNextPath(next) {
  const isLocalPath =
    typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\');
  // Never bounce back to the sign-in pages themselves (that would loop).
  const isAuthPage = isLocalPath && /^\/(login|signup)(\/|\?|$)/.test(next);
  return isLocalPath && !isAuthPage ? next : '/';
}
