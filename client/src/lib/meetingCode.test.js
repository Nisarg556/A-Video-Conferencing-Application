import { describe, expect, it } from 'vitest';
import { isValidMeetingCode, parseMeetingInput } from './meetingCode.js';

describe('parseMeetingInput (what people paste into "Join")', () => {
  it.each([
    ['kqz-mtrw-xpa', 'kqz-mtrw-xpa'],
    ['  KQZ-MTRW-XPA  ', 'kqz-mtrw-xpa'],
    ['kqzmtrwxpa', 'kqz-mtrw-xpa'], // typed from a screen share without dashes
    ['https://confer.example/m/kqz-mtrw-xpa', 'kqz-mtrw-xpa'],
    ['https://confer.example/m/kqz-mtrw-xpa/', 'kqz-mtrw-xpa'],
    ['https://confer.example/m/kqz-mtrw-xpa?utm_source=mail#x', 'kqz-mtrw-xpa'],
  ])('%s -> %s', (input, expected) => {
    expect(parseMeetingInput(input)).toBe(expected);
  });

  it.each(['', 'hello', 'kqz-mtrw', 'kqz-mtrw-xpa1', 'kq1-mtrw-xpa', 'https://evil.example/'])(
    'rejects %j',
    (input) => {
      expect(parseMeetingInput(input)).toBeNull();
    },
  );
});

describe('isValidMeetingCode', () => {
  it('accepts only the canonical lowercase form', () => {
    expect(isValidMeetingCode('kqz-mtrw-xpa')).toBe(true);
    expect(isValidMeetingCode('KQZ-MTRW-XPA')).toBe(false);
    expect(isValidMeetingCode('kqzmtrwxpa')).toBe(false);
  });
});
