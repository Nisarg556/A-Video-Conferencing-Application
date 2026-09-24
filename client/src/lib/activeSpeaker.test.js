import { describe, expect, it } from 'vitest';
import { ActiveSpeakerDetector } from './activeSpeaker.js';

const levels = (obj) => new Map(Object.entries(obj));

describe('ActiveSpeakerDetector', () => {
  it('reports nobody during silence or background noise', () => {
    const d = new ActiveSpeakerDetector();
    expect(d.update(levels({ a: 0, b: 0.01 }), 0)).toBeNull();
  });

  it('picks the person speaking', () => {
    const d = new ActiveSpeakerDetector();
    expect(d.update(levels({ a: 0.2, b: 0.01 }), 0)).toBe('a');
  });

  it('keeps the speaker highlighted through short pauses, then clears', () => {
    const d = new ActiveSpeakerDetector({ holdMs: 1000 });
    d.update(levels({ a: 0.2 }), 0);
    expect(d.update(levels({ a: 0 }), 500)).toBe('a');
    expect(d.update(levels({ a: 0 }), 1500)).toBeNull();
  });

  it('does not flicker to someone only slightly louder', () => {
    const d = new ActiveSpeakerDetector({ switchRatio: 1.5 });
    d.update(levels({ a: 0.2, b: 0.05 }), 0);
    expect(d.update(levels({ a: 0.2, b: 0.25 }), 250)).toBe('a');
    expect(d.update(levels({ a: 0.2, b: 0.35 }), 500)).toBe('b');
  });

  it('switches right away when the current speaker has stopped', () => {
    const d = new ActiveSpeakerDetector();
    d.update(levels({ a: 0.2, b: 0 }), 0);
    expect(d.update(levels({ a: 0, b: 0.06 }), 250)).toBe('b');
  });

  it('drops a speaker who left the meeting', () => {
    const d = new ActiveSpeakerDetector();
    d.update(levels({ a: 0.3 }), 0);
    expect(d.update(levels({ b: 0 }), 100)).toBeNull();
  });
});
