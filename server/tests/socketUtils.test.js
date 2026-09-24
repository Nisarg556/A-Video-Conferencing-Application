import { describe, expect, it } from 'vitest';
import { persistInOrder } from '../src/realtime/socketUtils.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('persistInOrder', () => {
  it('applies writes for the same participant in event order, even if the first is slower', async () => {
    const applied = [];
    // A slow "joined" write followed immediately by a fast "left" write:
    // without ordering, "left" would land first and then be overwritten.
    persistInOrder('p1', async () => {
      await sleep(50);
      applied.push('joined');
    });
    await persistInOrder('p1', async () => applied.push('left'));
    expect(applied).toEqual(['joined', 'left']);
  });

  it('does not make different participants wait for each other', async () => {
    const applied = [];
    const slow = persistInOrder('a', async () => {
      await sleep(50);
      applied.push('a');
    });
    await persistInOrder('b', async () => applied.push('b'));
    expect(applied).toEqual(['b']);
    await slow;
  });

  it('keeps going after a failed write', async () => {
    const applied = [];
    persistInOrder('p2', async () => {
      throw new Error('db hiccup');
    });
    await persistInOrder('p2', async () => applied.push('next'));
    expect(applied).toEqual(['next']);
  });
});
