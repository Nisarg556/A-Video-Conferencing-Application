// Must match the server's format. The server is the real authority —
// this only gives instant feedback before a request is made.
export const MEETING_CODE_REGEX = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
export const MEETING_TITLE_MAX = 80;

export function isValidMeetingCode(code) {
  return MEETING_CODE_REGEX.test(code);
}

/**
 * Accepts what people actually paste — "kqz-mtrw-xpa", "KQZMTRWXPA",
 * or a full invite link — and returns a normalized code, or null.
 */
export function parseMeetingInput(input) {
  const cleaned = input.trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
  const lastSegment = cleaned.split('/').pop() ?? '';
  const match = lastSegment.match(/^([a-z]{3})-?([a-z]{4})-?([a-z]{3})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}
