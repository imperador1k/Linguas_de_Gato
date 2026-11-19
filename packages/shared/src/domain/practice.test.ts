import { describe, expect, it } from 'vitest';
import { createLoopRange, findReplayCueIndex, resolveRangeAction, segmentPlaybackRange } from './practice.js';

describe('segmentPlaybackRange', () => {
  it('pads the cue with a lead-in and a tail', () => {
    expect(segmentPlaybackRange({ startMs: 1000, endMs: 2000 })).toEqual({ startMs: 850, endMs: 2250 });
  });

  it('never starts before zero or ends after the media', () => {
    expect(segmentPlaybackRange({ startMs: 50, endMs: 900 }, { durationMs: 1000 })).toEqual({ startMs: 0, endMs: 1000 });
  });

  it('ignores an unknown duration', () => {
    expect(segmentPlaybackRange({ startMs: 0, endMs: 100 }, { durationMs: 0, leadInMs: 0, tailMs: 0 })).toEqual({
      startMs: 0,
      endMs: 100,
    });
  });
});

describe('createLoopRange', () => {
  it('accepts a valid loop', () => {
    expect(createLoopRange(1000, 4000)).toEqual({ ok: true, value: { startMs: 1000, endMs: 4000 } });
  });

  it('rejects B before or equal to A', () => {
    const result = createLoopRange(4000, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('end-before-start');
    expect(createLoopRange(1000, 1000).ok).toBe(false);
  });

  it('rejects loops shorter than the minimum', () => {
    const result = createLoopRange(1000, 1200);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('too-short');
  });
});

describe('findReplayCueIndex', () => {
  const cues = [{ startMs: 1000 }, { startMs: 3000 }, { startMs: 6000 }];

  it('returns -1 without cues', () => {
    expect(findReplayCueIndex([], 500)).toBe(-1);
  });

  it('returns the first cue before any line has started', () => {
    expect(findReplayCueIndex(cues, 0)).toBe(0);
  });

  it('returns the most recent line, including in gaps between cues', () => {
    expect(findReplayCueIndex(cues, 3000)).toBe(1);
    expect(findReplayCueIndex(cues, 5999)).toBe(1);
    expect(findReplayCueIndex(cues, 60_000)).toBe(2);
  });
});

describe('resolveRangeAction', () => {
  const range = { startMs: 1000, endMs: 3000 };

  it('continues inside the range', () => {
    expect(resolveRangeAction(2000, range, 'segment')).toBe('continue');
    expect(resolveRangeAction(2000, range, 'loop')).toBe('continue');
  });

  it('wraps loops and stops segments at the end', () => {
    expect(resolveRangeAction(3000, range, 'loop')).toBe('wrap');
    expect(resolveRangeAction(3100, range, 'segment')).toBe('stop');
  });

  it('abandons a segment when the learner seeks far away', () => {
    expect(resolveRangeAction(10_000, range, 'segment')).toBe('abandon');
    expect(resolveRangeAction(0, range, 'segment')).toBe('abandon');
  });

  it('lets playback before a loop run into it', () => {
    expect(resolveRangeAction(0, range, 'loop')).toBe('continue');
  });

  it('wraps a loop even after a large jump past its end', () => {
    expect(resolveRangeAction(60_000, range, 'loop')).toBe('wrap');
  });
});
