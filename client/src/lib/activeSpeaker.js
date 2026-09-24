/**
 * Picks who is speaking from periodic audio levels (0..1 per participant).
 *
 * Plain "loudest wins" flickers between people and during short pauses, so:
 *  - below `threshold` counts as silence (background noise, muted mics);
 *  - the current speaker is kept for `holdMs` after they go quiet;
 *  - someone else takes over only when clearly louder (`switchRatio`).
 */
export class ActiveSpeakerDetector {
  constructor({ threshold = 0.04, holdMs = 1200, switchRatio = 1.5 } = {}) {
    this.threshold = threshold;
    this.holdMs = holdMs;
    this.switchRatio = switchRatio;
    this.current = null;
    this.lastHeardAt = 0;
  }

  /** @param {Map<string, number>} levels  @returns {string|null} */
  update(levels, now) {
    let loudest = null;
    let loudestLevel = 0;
    for (const [id, level] of levels) {
      if (level > loudestLevel) {
        loudest = id;
        loudestLevel = level;
      }
    }

    const currentLevel = this.current ? (levels.get(this.current) ?? 0) : 0;
    if (currentLevel >= this.threshold) this.lastHeardAt = now;

    if (loudestLevel >= this.threshold && loudest !== this.current) {
      const currentStillTalking = currentLevel >= this.threshold;
      if (!currentStillTalking || loudestLevel >= currentLevel * this.switchRatio) {
        this.current = loudest;
        this.lastHeardAt = now;
      }
    }

    // Left the meeting, or silent for longer than the hold time.
    if (this.current && (!levels.has(this.current) || now - this.lastHeardAt > this.holdMs)) {
      this.current = null;
    }
    return this.current;
  }
}
