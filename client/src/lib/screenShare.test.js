import { describe, expect, it, vi } from 'vitest';
import { startScreenShare } from './screenShare.js';

class FakeScreenTrack extends EventTarget {
  kind = 'video';
  readyState = 'live';
  contentHint = '';
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
  // What the browser does when the user clicks its native "Stop sharing" bar.
  endFromBrowser() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

function setup({ claimResult = { ok: true }, pickerError } = {}) {
  const track = new FakeScreenTrack();
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const deps = {
    getDisplayMedia: vi.fn(async () => {
      if (pickerError) throw pickerError;
      return stream;
    }),
    claim: vi.fn(async () => (claimResult instanceof Error ? Promise.reject(claimResult) : claimResult)),
    release: vi.fn(),
    onEnded: vi.fn(),
  };
  return { track, deps };
}

const domError = (name, message = '') => Object.assign(new Error(message), { name });

describe('startScreenShare', () => {
  it('captures first, then claims the presenter slot, and tunes the track for text', async () => {
    const { track, deps } = setup();
    const result = await startScreenShare(deps);

    expect(result).toEqual({ status: 'started', track });
    expect(deps.getDisplayMedia).toHaveBeenCalledBefore(deps.claim);
    expect(track.contentHint).toBe('detail');
  });

  it('treats closing the picker as a cancel, not an error, and never asks the server', async () => {
    const { deps } = setup({ pickerError: domError('NotAllowedError', 'Permission denied') });
    expect(await startScreenShare(deps)).toEqual({ status: 'cancelled' });
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it('explains when the operating system blocks screen capture', async () => {
    const { deps } = setup({ pickerError: domError('NotAllowedError', 'Permission denied by system') });
    const result = await startScreenShare(deps);
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/operating system/);
  });

  it('stops the capture if someone else is already presenting', async () => {
    const { track, deps } = setup({
      claimResult: { ok: false, error: { code: 'SCREEN_SHARE_BUSY', message: 'Ada is already presenting' } },
    });
    expect(await startScreenShare(deps)).toEqual({ status: 'busy', message: 'Ada is already presenting' });
    expect(track.stop).toHaveBeenCalled(); // no orphaned capture / sharing indicator
  });

  it('stops the capture if the server can’t be reached', async () => {
    const { track, deps } = setup({ claimResult: new Error('timeout') });
    const result = await startScreenShare(deps);
    expect(result.status).toBe('error');
    expect(track.stop).toHaveBeenCalled();
  });

  it('calls onEnded when the browser’s native "Stop sharing" button is used', async () => {
    const { track, deps } = setup();
    await startScreenShare(deps);

    track.endFromBrowser();
    expect(deps.onEnded).toHaveBeenCalledTimes(1);
  });

  it('releases the slot if sharing was stopped while the claim was in flight', async () => {
    const { track, deps } = setup();
    deps.claim.mockImplementation(async () => {
      track.endFromBrowser(); // user hit "Stop sharing" during the round-trip
      return { ok: true };
    });

    expect(await startScreenShare(deps)).toEqual({ status: 'cancelled' });
    expect(deps.release).toHaveBeenCalled();
    expect(deps.onEnded).not.toHaveBeenCalled();
  });
});
